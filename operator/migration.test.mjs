import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { preparePlan, canonical, fingerprint, assetId, reconcile, requireFences, applyPlan, verifyPlan, validateIntent } from './migrate-shinsekai.mjs'
const subject='verified-google-identity', accountId='11111111-1111-4111-8111-111111111111', portraitId='22222222-2222-4222-8222-222222222222'
function fixture(){
 const row=(id,data)=>({id,name:'Fixture',updatedAt:'2026-10-03T00:00:00Z',data:JSON.stringify(data)})
 return {'sd-account':{total:1,items:[row(accountId,{parent:'existing-workspace',google_id:subject,email:'fixture@example.invalid'})]},'sd-character':{total:1,items:[row('33333333-3333-4333-8333-333333333333',{parent:'existing-workspace',account:accountId,portrait:portraitId,name:'Fixture'})]},'sd-portrait':{total:1,items:[row(portraitId,{parent:'existing-workspace',account:accountId,image_url:'/api/assets/44444444-4444-4444-8444-444444444444.png'})]}}
}
const owner={id:'55555555-5555-4555-8555-555555555555',provider_id:subject}, workspace={id:'66666666-6666-4666-8666-666666666666',slug:'existing-workspace',data:{description:'Retained description'}}
test('dry run keeps stable ownership/portrait references and verified GM identity',()=>{
 const p=preparePlan(fixture(),owner,workspace)
 assert.equal(p.accounts.length,1);assert.equal(p.characters.length,1);assert.equal(p.accounts[0].gm,true)
 assert.equal(p.accounts[0].oldId,accountId);assert.equal(p.characters[0].oldOwner,accountId)
 assert.equal(p.preserved.transcriptWrites,0);assert.equal(p.description,'Retained description')
 assert.equal(p.characters[0].portraitAsset,'44444444-4444-4444-8444-444444444444.png')
})
test('duplicate Google identities cannot be silently merged',()=>{
 const v=fixture();v['sd-account'].items.push({...v['sd-account'].items[0],id:'77777777-7777-4777-8777-777777777777'});v['sd-account'].total++
 assert.throws(()=>preparePlan(v,owner,workspace),/Duplicate/)
})
test('orphan characters and foreign portraits fail before writing',()=>{
 const v=fixture();v['sd-character'].items[0].data=JSON.stringify({account:'unknown',portrait:portraitId})
 assert.throws(()=>preparePlan(v,owner,workspace),/Orphan/)
 const bad=fixture();bad['sd-portrait'].items[0].data=JSON.stringify({account:'different-owner',image_url:'/api/assets/44444444-4444-4444-8444-444444444444.png'})
 assert.throws(()=>preparePlan(bad,owner,workspace),/owner mismatch/)
})
test('incomplete inventory and unmatched GM identity cannot execute',()=>{
 const v=fixture();v['sd-account'].total=500
 assert.throws(()=>preparePlan(v,owner,workspace),/Incomplete/)
 assert.throws(()=>preparePlan(fixture(),{...owner,provider_id:'different'},workspace),/Initial GM/)
})

test('fingerprints are insensitive to object order but detect changed source content',()=>{
 const a={id:accountId,name:'Fixture',updatedAt:'same',data:{b:2,a:{z:3,x:1}}}
 const b={...a,data:{a:{x:1,z:3},b:2}}
 assert.equal(fingerprint(a),fingerprint(b));b.data.a.x=4;assert.notEqual(fingerprint(a),fingerprint(b))
})
test('remote assets and foreign native workspace references are rejected',()=>{
 const p=fixture()['sd-portrait'].items[0];p.data={parent:'existing-workspace',image_url:'https://foreign.invalid/api/assets/44444444-4444-4444-8444-444444444444.png'}
 assert.throws(()=>assetId(p,'existing-workspace'),/Unsupported/)
 p.data.parent='different';assert.throws(()=>assetId(p,'existing-workspace'),/workspace/)
})
function harness(){
 const inventory=fixture(),plan=preparePlan(inventory,owner,workspace),rows=new Map(),writes=[],assets=Buffer.from('unchanged fixture portrait bytes')
 plan.dependencies.forEach(p=>p.assetHash=createHash('sha256').update(assets).digest('hex'))
 const installation=randomUUID(),pluginId=randomUUID(),roleId=randomUUID(),ownerAgentId=randomUUID();let version=0
 const state={story:true,portal:true,crashReady:false,changedAssets:false,saves:0}
 const project=e=>e?{...e,data:Object.fromEntries(Object.entries(e.data).filter(([k])=>k!=='portal_secret')),portalSecretConfigured:!!e.data.portal_secret}:null
 const connection={secret:Buffer.alloc(32,7).toString('base64url'),client:'fixture-test.apps.googleusercontent.com',save:async()=>{state.saves++},asset:async()=>state.changedAssets?Buffer.from('changed'):assets,status:async()=>({version:'storyboard/1',writesFenced:state.portal}),call:async(path,method='GET',body)=>{
  if(path.endsWith('/status'))return{writesFenced:state.story,googleConfigured:true,installation,ownerAgentId}
  if(path==='/api/entities/storyboard')return{id:pluginId}
  if(path.startsWith('/api/entities?'))return{items:[{id:roleId,data:{key:'gm',owner_id:owner.id}},{id:randomUUID(),data:{key:'player',owner_id:owner.id}}]}
  const match=path.match(/\/manage\/entities\/([^/]+)\/([^/]+)$/);assert.ok(match,'Only typed management record API may write')
  const key=match[1]+':'+match[2],existing=rows.get(key)
  if(method==='GET')return project(existing)
  assert.equal(method,'PUT');assert.ok(Object.hasOwn(body,'expectedUpdatedAt'));assert.equal(body.expectedUpdatedAt,existing?.updatedAt??null,'Mandatory CAS')
  const e={id:existing?.id??randomUUID(),typeSlug:match[1],slug:match[2],name:body.name,updatedAt:String(++version),data:{...body.data,owner_id:owner.id,owner_agent_id:ownerAgentId,owner_plugin:pluginId,installation,confidential:true}}
  rows.set(key,e);writes.push({path,body})
  if(state.crashReady&&body.data.state==='ready'){state.crashReady=false;throw Error('Fixture crash after ready publication')}
  return project(e)
 }}
 return{inventory,plan,rows,writes,state,connection,installation,pluginId}
}
test('both fences and unchanged asset bytes are prerequisites before any write',async()=>{
 for(const side of ['story','portal']){const h=harness();h.state[side]=false;await assert.rejects(applyPlan(h.plan,h.inventory,h.connection),/Both/);assert.equal(h.writes.length,0)}
 const h=harness();h.state.changedAssets=true;await assert.rejects(applyPlan(h.plan,h.inventory,h.connection),/bytes changed/);assert.equal(h.writes.length,0)
})
test('apply uses typed CAS, preserves ownership/source fields and records every exact target',async()=>{
 const h=harness();await applyPlan(h.plan,h.inventory,h.connection);await verifyPlan(h.plan,h.inventory,h.connection)
 assert.equal(h.plan.targetIds.accounts[accountId],h.rows.get('storyboard-account:'+h.plan.accounts[0].slug).id)
 assert.equal(h.rows.get('storyboard-account:'+h.plan.accounts[0].slug).data.legacy_owner,accountId)
 const character=h.rows.get('storyboard-character:'+h.plan.characters[0].slug);assert.equal(canonical(character.data.game_data),canonical(dataOfFixtureCharacter(h.inventory)))
 assert.equal(h.plan.targetIds.characters[character.data.legacy_id],character.id);assert.ok(h.plan.targetIds.portal);assert.ok(h.plan.targetIds.readyUpdatedAt)
 const count=h.writes.length;await applyPlan(h.plan,h.inventory,h.connection);assert.equal(h.writes.length,count,'Ready retry makes no writes')
 assert.ok(h.state.saves>5);assert.equal(h.writes.filter(w=>w.body.data.state==='ready').length,1)
})
function dataOfFixtureCharacter(inventory){return JSON.parse(inventory['sd-character'].items[0].data)}
test('a new canonical sign-in or other run fails reconciliation before target writes',async()=>{
 const h=harness();h.rows.set('storyboard-account:'+h.plan.accounts[0].slug,{id:randomUUID(),name:'Fixture',data:{google_subject:subject},updatedAt:'1'})
 await assert.rejects(applyPlan(h.plan,h.inventory,h.connection),/reconciliation/);assert.equal(h.writes.length,0)
})
test('final ready publication crash resumes only its recorded exact intent',async()=>{
 const h=harness();h.state.crashReady=true;await assert.rejects(applyPlan(h.plan,h.inventory,h.connection),/Fixture crash/)
 assert.ok(h.plan.readyIntent);assert.equal(h.plan.targetIds.readyUpdatedAt,undefined)
 const count=h.writes.length;await applyPlan(h.plan,h.inventory,h.connection);assert.equal(h.writes.length,count);assert.ok(h.plan.targetIds.readyUpdatedAt)
 h.plan.targetIds.characters[h.plan.characters[0].oldId]=randomUUID();await assert.rejects(verifyPlan(h.plan,h.inventory,h.connection),/reconciliation/)
})

test('modified GM mapping or changed native workspace invalidates prepared intent',()=>{
 const inv=fixture(),plan=preparePlan(inv,owner,workspace);validateIntent(plan,inv,owner,workspace)
 plan.accounts[0].gm=false;assert.throws(()=>validateIntent(plan,inv,owner,workspace),/intent/)
 const clean=preparePlan(inv,owner,workspace);assert.throws(()=>validateIntent(clean,inv,owner,{...workspace,data:{description:'Changed native page'}}),/intent/)
})

test('CLI resolves the real Leaf auth_provider identity schema without exposing subject', async () => {
 const { resolveLeafOwner } = await import('./migrate-shinsekai.mjs')
 const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', privateSubject='private:google-owner'
 const paths=[]
 const call=async path=>{paths.push(path);return path==='/auth/execution-context'?{tokenUse:'execution',identity:{beneficiary:{kind:'user',userId:ownerId}}}:{id:ownerId,typeSlug:'user',data:{auth_provider:'google',provider_id:privateSubject}}}
 assert.deepEqual(await resolveLeafOwner(call),{id:ownerId,provider_id:privateSubject})
 assert.deepEqual(paths,['/auth/execution-context','/api/entities/'+ownerId])
 for(const data of [{provider:'google',provider_id:privateSubject},{auth_provider:'password',provider_id:privateSubject},{auth_provider:'google'}])await assert.rejects(resolveLeafOwner(async path=>path==='/auth/execution-context'?{tokenUse:'execution',identity:{beneficiary:{kind:'user',userId:ownerId}}}:{id:ownerId,typeSlug:'user',data}),/Verified Leaf Google owner required/)
})

test('operator owns original game schema validation and registers it before characters', async () => {
 const h=harness();await applyPlan(h.plan,h.inventory,h.connection)
 const portalIndex=h.writes.findIndex(w=>w.path.includes('/storyboard-portal/')),charIndex=h.writes.findIndex(w=>w.path.includes('/storyboard-character/'))
 assert.ok(portalIndex>=0&&portalIndex<charIndex)
 assert.equal(h.writes[portalIndex].body.data.portrait_type,'sd-portrait')
 assert.equal(h.writes[portalIndex].body.data.character_fields.age.type,'string')
 const invalid=fixture();const data=JSON.parse(invalid['sd-character'].items[0].data);data.age=32;invalid['sd-character'].items[0].data=JSON.stringify(data)
 assert.throws(()=>preparePlan(invalid,owner,workspace),/registered field schema: age/)
 data.age='32';invalid['sd-character'].items[0].data=JSON.stringify(data);assert.equal(preparePlan(invalid,owner,workspace).characters.length,1)
})
