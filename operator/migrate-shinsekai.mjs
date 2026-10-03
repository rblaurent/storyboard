// One-time operator tool. Never loaded or scheduled by the extension.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha = value => createHash('sha256').update(value).digest('hex')
export const dataOf = entity => typeof entity.data === 'string' ? JSON.parse(entity.data) : entity.data
export const canonical = value => JSON.stringify(sort(value))
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value }
export const fingerprint = entity => sha(canonical({ id: entity.id, name: entity.name, updatedAt: entity.updatedAt, data: dataOf(entity) }))
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
export function assetId(portrait, workspace) {
 const d = dataOf(portrait)
 if (d.parent !== workspace) throw Error('Portrait workspace mismatch')
 const image = new URL(d.image_url, 'http://127.0.0.1:18804')
 if (image.origin !== 'http://127.0.0.1:18804' || image.search || image.hash || image.username || !/^\/api\/assets\/[a-f0-9-]{36}\.(png|webp|jpg|jpeg)$/.test(image.pathname) || !uuid(image.pathname.split('/').at(-1).split('.')[0])) throw Error('Unsupported portrait asset')
 return image.pathname.split('/').at(-1)
}
const accountSlug = subject => 'g-' + sha('https://accounts.google.com|' + subject)
export const portalSchema = { portrait_type:'sd-portrait', character_key:'gid', character_fields:Object.fromEntries([
 ...['age','gid','name','gender','posting','division','homeworld','specialization'].map(key=>[key,{type:'string',maxLength:256}]),
 ['statement',{type:'string',maxLength:4000}],['portrait',{type:'portrait',maxLength:256}],['tier',{type:'integer',min:0,max:10}],['onboarded',{type:'boolean'}]
]) }
export function preparePlan(inventory, leafOwner, workspace) {
  if (!uuid(leafOwner.id) || !uuid(workspace.id) || !workspace.slug) throw Error('Invalid owner/workspace identity')
  const accounts = inventory['sd-account'].items, characters = inventory['sd-character'].items, portraits = inventory['sd-portrait'].items
  for (const type of ['sd-account', 'sd-character', 'sd-portrait']) { if (inventory[type].total !== inventory[type].items.length) throw Error('Incomplete inventory: ' + type); if (new Set(inventory[type].items.map(e=>e.id)).size!==inventory[type].items.length) throw Error('Duplicate source IDs: '+type) }
  const subjects = new Set(), owners = new Map(accounts.map(a => [a.id, a])), portraitById = new Map(portraits.map(p => [p.id, p]))
  const mapped = accounts.map(account => {
    const d = dataOf(account)
    if (!uuid(account.id) || d.parent !== workspace.slug) throw Error('Invalid source account/workspace')
    if (typeof d.google_id !== 'string' || !d.google_id.trim() || d.google_id.length > 255 || subjects.has(d.google_id)) throw Error('Duplicate or missing Google identity')
    subjects.add(d.google_id)
    return { oldId: account.id, slug: accountSlug(d.google_id), sourceHash: fingerprint(account), gm: d.google_id === leafOwner.provider_id }
  })
  if (mapped.filter(a => a.gm).length !== 1) throw Error('Initial GM must match exactly one verified Leaf Google identity')
  const chars = characters.map(character => {
    const d = dataOf(character), owner = owners.get(d.account), portrait = portraitById.get(d.portrait)
    if (!owner) throw Error('Orphan character: ' + character.id)
    if (!portrait) throw Error('Missing portrait: ' + character.id)
    const pd = dataOf(portrait)
    if (pd.account && pd.account !== owner.id) throw Error('Portrait owner mismatch: ' + character.id)
    if (!uuid(character.id) || d.parent !== workspace.slug) throw Error('Invalid source character/workspace')
    for(const [key,rule] of Object.entries(portalSchema.character_fields))if(Object.hasOwn(d,key)){
     const value=d[key]
     if(rule.type==='integer'&&(!Number.isInteger(value)||value<rule.min||value>rule.max)||rule.type==='boolean'&&typeof value!=='boolean'||(rule.type==='string'||rule.type==='portrait')&&(typeof value!=='string'||value.length>rule.maxLength))throw Error('Source character does not match registered field schema: '+key)
    }
    const asset = assetId(portrait, workspace.slug)
    return { oldId: character.id, oldOwner: owner.id, slug: 'migrated-' + character.id, portraitAsset: asset, sourceHash: fingerprint(character) }
  })
  const sourceIdentity = Object.fromEntries(Object.keys(inventory).sort().map(type => [type, inventory[type].items.map(e => ({id:e.id,hash:fingerprint(e)})).sort((a,b)=>a.id.localeCompare(b.id))]))
  return { schema: 'storyboard-migration/2', run: 'shinsekai-' + workspace.id + '-' + sha(canonical(sourceIdentity)).slice(0,16), workspaceId: workspace.id, workspaceSlug: workspace.slug, description: dataOf(workspace).description || '', workspaceHash:fingerprint(workspace), campaignSlug: 'migrated-campaign-' + workspace.id, ownerId: leafOwner.id, accounts: mapped, characters: chars, preserved: { portraits: portraits.length, sourceAccounts: accounts.length, sourceCharacters: characters.length, ownershipIds: 'unchanged', transcriptWrites: 0 }, dependencies: portraits.map(p => ({ id: p.id, hash: fingerprint(p), asset: assetId(p,workspace.slug) })) }
}
export function validateIntent(plan,inventory,leafOwner,workspace) {
 const current=preparePlan(inventory,leafOwner,workspace)
 for(const key of ['schema','run','workspaceId','workspaceSlug','workspaceHash','description','campaignSlug','ownerId','accounts','characters','preserved'])if(canonical(plan[key])!==canonical(current[key]))throw Error('Prepared intent/source reconciliation required: '+key)
 if(!Array.isArray(plan.dependencies)||plan.dependencies.length!==current.dependencies.length||current.dependencies.some(p=>{const old=plan.dependencies.find(e=>e.id===p.id);return !old||old.hash!==p.hash||old.asset!==p.asset}))throw Error('Prepared portrait dependencies changed')
}
function parseArgs(args) {
  const values = {}
  for (let n = 0; n < args.length; n += 2) {
    if (!args[n].startsWith('--') || !args[n + 1]) throw Error('Expected --mode prepare|apply|verify --output <scratch-directory> [--source shinsekai-e47ab86c]')
    values[args[n].slice(2)] = args[n + 1]
  }
  return values
}
export async function resolveLeafOwner(call) {
  const identity = await call('/auth/execution-context')
  if (identity.tokenUse !== 'execution' || !identity.identity) throw Error('Signed execution identity required')
  const ownerId = identity.identity.beneficiary?.userId || identity.identity.beneficiary?.id
  if (identity.identity.beneficiary?.kind !== 'user' || !uuid(ownerId)) throw Error('Human beneficiary required')
  const owner = await call('/api/entities/' + ownerId)
  const od = dataOf(owner)
  if (owner.id !== ownerId || owner.typeSlug !== 'user' || od.auth_provider !== 'google' || typeof od.provider_id !== 'string' || !od.provider_id.trim() || od.provider_id.length > 255) throw Error('Verified Leaf Google owner required')
  return { id: owner.id, provider_id: od.provider_id }
}
export async function run(args) {
  const { mode = 'prepare', output, source = 'shinsekai-e47ab86c' } = parseArgs(args)
  if (!output || !['prepare', 'apply', 'verify'].includes(mode)) throw Error('Valid mode and scratch output required')
  const scratch = resolve(process.env.REDLEAF_SCRATCH_DIR || '')
  const folder = resolve(output)
  const within = relative(scratch, folder)
  if (!process.env.REDLEAF_SCRATCH_DIR || !within || within.startsWith('..') || isAbsolute(within)) throw Error('Output must be inside session scratch')
  const token = process.env.REDLEAF_EXECUTION_TOKEN
  if (!token) throw Error('authentication_required')
  const call = async (path, method = 'GET', body) => {
    const response = await fetch('http://127.0.0.1:18804' + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) throw Error('Leaf ' + response.status + ' for ' + method + ' ' + path)
    return response.json()
  }
  const leafOwner = await resolveLeafOwner(call)
  const ownerId = leafOwner.id
  const list = async (type, workspace) => {
    const items = []; let total = Infinity
    while (items.length < total) {
      const query = new URLSearchParams({ type, limit: '500', offset: String(items.length), ...(workspace ? { 'data.parent': workspace } : {}) })
      const page = await call('/api/entities?' + query)
      total = page.total; items.push(...page.items)
      if (!page.items.length && items.length < total) throw Error('Inventory changed during pagination')
    }
    return { items, total }
  }
  await mkdir(folder, { recursive: true })
  let plan, inventory
  const planPath = join(folder, 'manifest.json'), exportPath = join(folder, 'source-export.json')
  if (mode === 'prepare') {
    inventory = {}
    for (const type of ['sd-account', 'sd-character', 'sd-portrait']) inventory[type] = await list(type, source)
    const workspace = await call('/api/entities/' + encodeURIComponent(source))
    plan = preparePlan(inventory, leafOwner, workspace)
    for (const item of plan.dependencies) {
     const response = await fetch('http://127.0.0.1:18804/api/assets/' + item.asset, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(30000) })
     if (!response.ok) throw Error('Portrait asset unavailable')
     const bytes = Buffer.from(await response.arrayBuffer()); item.assetHash = sha(bytes)
    }
    await writeFile(exportPath, JSON.stringify(inventory, null, 2), { flag: 'wx' })
    await writeFile(planPath, JSON.stringify(plan, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ mode, run: plan.run, accounts: plan.accounts.length, characters: plan.characters.length, portraits: plan.preserved.portraits, manifest: planPath, productionWrites: 0 }))
    return
  }
  plan = JSON.parse(await readFile(planPath, 'utf8')); inventory = JSON.parse(await readFile(exportPath, 'utf8'))
  if (plan.ownerId !== ownerId || plan.schema !== 'storyboard-migration/2') throw Error('Manifest owner/schema mismatch')
  for (const type of ['sd-account', 'sd-character', 'sd-portrait']) {
    const current = await list(type, plan.workspaceSlug), expected = inventory[type]
    if (current.total !== expected.total) throw Error('Source inventory changed: ' + type)
    const old = new Map(expected.items.map(e => [e.id, fingerprint(e)]))
    if (current.items.some(e => old.get(e.id) !== fingerprint(e))) throw Error('Source changed since export: ' + type)
  }
  const nativeWorkspace=await call('/api/entities/'+encodeURIComponent(plan.workspaceSlug))
  validateIntent(plan,inventory,leafOwner,nativeWorkspace)
  // The confidential config is intentionally absent from generic entity lists.
  // Reaching owner-only management status proves both provisioning and ownership.
  const settings = await call('/api/apps/storyboard/manage/status')
  if (!settings || !uuid(settings.installation) || !uuid(settings.ownerAgentId)) throw Error('Provision Storyboard before apply/verify')
  const connection = {
   call, status: async () => {
    const response = await fetch('https://shinsekai.minititine.cc/storyboard-status', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) })
    return response.ok ? response.json() : null
   }, secret: process.env.STORYBOARD_PORTAL_SECRET, client: process.env.SHINSEKAI_GOOGLE_CLIENT_ID,
   save: async () => { await writeFile(planPath + '.new', JSON.stringify(plan,null,2)); await rename(planPath + '.new',planPath) },
   asset: async id => {
    const response = await fetch('http://127.0.0.1:18804/api/assets/' + id, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw Error('Portrait asset unavailable')
    return Buffer.from(await response.arrayBuffer())
   }
  }
  if (mode === 'apply') await applyPlan(plan, inventory, connection)
  await verifyPlan(plan, inventory, connection)
  console.log(JSON.stringify({ mode, run: plan.run, verifiedAccounts: plan.accounts.length, verifiedCharacters: plan.characters.length, portraitRecordsPreserved: plan.preserved.portraits, sourceRecordsChanged: 0, transcriptWrites: 0, writesRemainFenced: Boolean(settings.writesFenced) }))
}

const manage = '/api/apps/storyboard/manage'
const targetPath = (type,slug) => manage + '/entities/' + encodeURIComponent(type) + '/' + encodeURIComponent(slug)
export function reconcile(existing, expected, plan, name, expectedId) {
 if (!existing) { if (expectedId) throw Error('Recorded target missing'); return }
 const d = dataOf(existing)
 if (existing.name !== name || (expectedId && existing.id !== expectedId) || d.migration_run !== plan.run || d.installation !== plan.installation || d.owner_id !== plan.ownerId || d.owner_agent_id !== plan.ownerAgentId || d.confidential !== true || d.owner_plugin !== plan.pluginId || !uuid(existing.id)) throw Error('Existing target requires reconciliation')
 for (const [key,value] of Object.entries(expected)) {
  if (key === 'portal_secret') { if (!existing.portalSecretConfigured) throw Error('Portal secret not configured'); continue }
  if (canonical(d[key]) !== canonical(value)) throw Error('Existing target content requires reconciliation: ' + key)
 }
}
export async function requireFences(connection) {
 const [story,portal] = await Promise.all([connection.call(manage + '/status'),connection.status()])
 if (story?.writesFenced !== true || portal?.version !== 'storyboard/1' || portal?.writesFenced !== true) throw Error('Both Storyboard and portal writes must be fenced')
 if(story.googleConfigured!==true)throw Error('Configure actual Storyboard Google credentials before apply')
 return story
}
export async function applyPlan(plan,inventory,connection) {
 if (plan.schema !== 'storyboard-migration/2' || !uuid(plan.ownerId) || !plan.dependencies.every(p => /^[a-f0-9]{64}$/.test(p.assetHash || ''))) throw Error('Reprepare with asset fingerprints and CAS schema')
 if (!/^[A-Za-z0-9_-]{43}$/.test(connection.secret || '') || Buffer.from(connection.secret,'base64url').toString('base64url') !== connection.secret || !connection.client?.endsWith('.apps.googleusercontent.com') || /placeholder|your-|example/i.test(connection.client)) throw Error('Actual portal secret and Google client ID required')
 if(plan.portalKeyFingerprint && plan.portalKeyFingerprint!==sha(connection.secret))throw Error('Portal credential changed since receipt')
 plan.portalKeyFingerprint=sha(connection.secret)
 const status=await requireFences(connection)
 for(const p of plan.dependencies)if(sha(await connection.asset(p.asset))!==p.assetHash)throw Error('Portrait bytes changed before apply')
 const pluginRows=await connection.call('/api/entities?'+new URLSearchParams({type:'plugin',limit:'500'}))
 const plugins=pluginRows.items.filter(e=>e.typeSlug==='plugin'&&e.slug==='storyboard')
 if(plugins.length!==1)throw Error('Storyboard plugin identity is ambiguous')
 const plugin=plugins[0]
 if(plan.pluginId&&plan.pluginId!==plugin.id){
  // Recover the first live receipt only when the old untyped slug lookup
  // selected the Storyboard workspace page before any target IDs were recorded.
  const ambiguous=await connection.call('/api/entities/'+plan.pluginId)
  if(ambiguous?.typeSlug!=='page'||ambiguous.slug!=='storyboard'||plan.targetIds)throw Error('Installation/plugin reconciliation required')
  plan.pluginId=undefined
 }
 if(!uuid(status.installation)||!uuid(plugin.id)||plan.installation&&plan.installation!==status.installation)throw Error('Installation/plugin reconciliation required')
 if(!uuid(status.ownerAgentId)||plan.ownerAgentId&&plan.ownerAgentId!==status.ownerAgentId)throw Error('Owning Agent reconciliation required')
 plan.ownerAgentId=status.ownerAgentId;plan.installation=status.installation;plan.pluginId=plugin.id;await connection.save?.()
 plan.targetIds ||= {}; plan.targetIds.accounts ||= {}; plan.targetIds.members ||= {}; plan.targetIds.characters ||= {}
 const save = async () => connection.save?.()
 const read = (type,slug) => connection.call(targetPath(type,slug))
 const ensure = async (type,slug,name,data,recorded) => {
  const existing = await read(type,slug); reconcile(existing,data,plan,name,recorded)
  if (existing) return existing
  await requireFences(connection)
  const created = await connection.call(targetPath(type,slug),'PUT',{name,data:{...data,migration_run:plan.run},expectedUpdatedAt:null})
  reconcile(created,data,plan,name)
  return created
 }
 const accountData = mapping => {
  const source=inventory['sd-account'].items.find(e=>e.id===mapping.oldId), d=dataOf(source)
  return {google_issuer:'https://accounts.google.com',google_subject:d.google_id,email:d.email || '',email_key:sha((d.email || '').toLowerCase()),avatar:d.avatar_url || '',enabled:true,can_create:mapping.gm,legacy_owner:source.id,parent:plan.workspaceId}
 }
 // Fail on a concurrent canonical sign-in or foreign run before any target writes.
 for (const mapping of plan.accounts) {
  const source=inventory['sd-account'].items.find(e=>e.id===mapping.oldId)
  reconcile(await read('storyboard-account',mapping.slug),accountData(mapping),plan,source.name,plan.targetIds.accounts[mapping.oldId])
 }
 let campaign=await read('storyboard-campaign',plan.campaignSlug)
 const campaignData={state:'provisioning',creator:'',workspace:plan.workspaceId,description:plan.description,summary:'',archived:false,revision:1,parent:plan.workspaceId}
 if(campaign && dataOf(campaign).state==='ready') {
  if(!plan.targetIds.campaign || !plan.readyIntent) throw Error('Ready target requires complete receipt')
  await verifyPlan(plan,inventory,connection); return
 }
 campaign=await ensure('storyboard-campaign',plan.campaignSlug,'Shinsekai',campaignData,plan.targetIds.campaign)
 plan.targetIds.campaign=campaign.id; await save()
 const accounts=new Map(),members=new Map()
 for(const mapping of plan.accounts) {
  const source=inventory['sd-account'].items.find(e=>e.id===mapping.oldId)
  const account=await ensure('storyboard-account',mapping.slug,source.name,accountData(mapping),plan.targetIds.accounts[mapping.oldId])
  accounts.set(source.id,account);plan.targetIds.accounts[source.id]=account.id;await save()
  const role=mapping.gm?'gm':'player'
  const roleRows=await connection.call('/api/entities?'+new URLSearchParams({type:'storyboard-role',limit:'500'}))
  const definition=roleRows.items.find(e=>dataOf(e).key===role)
  if(!definition || dataOf(definition).owner_id!==plan.ownerId)throw Error('Protected role definition required')
  const slug='m-'+sha(campaign.id+':'+account.id)
  const member=await ensure('storyboard-player',slug,source.name,{campaign:campaign.id,account:account.id,role,role_ref:definition.id,active:true,parent:plan.workspaceId},plan.targetIds.members[source.id])
  members.set(source.id,member);plan.targetIds.members[source.id]=member.id;await save()
 }
 const portal=await ensure('storyboard-portal','shinsekai','Shinsekai player portal',{key:'shinsekai',campaign:campaign.id,google_client_id:connection.client,portal_secret:connection.secret,legacy_workspace:plan.workspaceSlug,...portalSchema,parent:plan.workspaceId},plan.targetIds.portal)
 plan.targetIds.portal=portal.id;await save()
 for(const mapping of plan.characters) {
  const source=inventory['sd-character'].items.find(e=>e.id===mapping.oldId)
  const character=await ensure('storyboard-character',mapping.slug,source.name,{campaign:campaign.id,account:accounts.get(mapping.oldOwner).id,player:members.get(mapping.oldOwner).id,portrait:mapping.portraitAsset,legacy_id:source.id,game_key:'shinsekai',game_data:dataOf(source),parent:plan.workspaceId},plan.targetIds.characters[source.id])
  plan.targetIds.characters[source.id]=character.id;await save()
 }

 await requireFences(connection)
 const fields={...campaignData,state:'ready',creator:accounts.get(plan.accounts.find(a=>a.gm).oldId).id,migration_run:plan.run}
 // Record the exact intent before the final CAS, so a crash after publication can
 // reconcile the ready document without silently accepting a different target.
 plan.readyIntent={id:campaign.id,expectedUpdatedAt:campaign.updatedAt,data:fields};await save()
 const ready=await connection.call(targetPath('storyboard-campaign',plan.campaignSlug),'PUT',{name:'Shinsekai',data:fields,expectedUpdatedAt:campaign.updatedAt})
 plan.targetIds.readyUpdatedAt=ready.updatedAt;await save()
}
export async function verifyPlan(plan,inventory,connection) {
 const ids=plan.targetIds
 if(!uuid(ids?.campaign)||!uuid(ids?.portal)||!ids?.accounts||!ids?.members||!ids?.characters||!plan.accounts.every(a=>uuid(ids.accounts[a.oldId])&&uuid(ids.members[a.oldId]))||!plan.characters.every(c=>uuid(ids.characters[c.oldId]))||!plan.readyIntent)throw Error('Complete exact target receipt required')
 const campaign=await connection.call(targetPath('storyboard-campaign',plan.campaignSlug))
 reconcile(campaign,plan.readyIntent.data,plan,'Shinsekai',ids.campaign)
 if(dataOf(campaign).state!=='ready')throw Error('Campaign not ready')
 if(!ids.readyUpdatedAt) { // Recover final publication only when every recorded intent field matches.
  ids.readyUpdatedAt=campaign.updatedAt;await connection.save?.()
 }
 if(campaign.updatedAt!==ids.readyUpdatedAt)throw Error('Ready campaign changed since receipt')
 for(const mapping of plan.accounts) {
  const source=inventory['sd-account'].items.find(e=>e.id===mapping.oldId),d=dataOf(source)
  const account=await connection.call(targetPath('storyboard-account',mapping.slug))
  reconcile(account,{legacy_owner:mapping.oldId,google_subject:d.google_id,google_issuer:'https://accounts.google.com',enabled:true,can_create:mapping.gm},plan,source.name,ids.accounts[mapping.oldId])
  const member=await connection.call(targetPath('storyboard-player','m-'+sha(ids.campaign+':'+ids.accounts[mapping.oldId])))
  reconcile(member,{account:ids.accounts[mapping.oldId],campaign:ids.campaign,role:mapping.gm?'gm':'player',active:true},plan,source.name,ids.members[mapping.oldId])
 }
 for(const mapping of plan.characters) {
  const source=inventory['sd-character'].items.find(e=>e.id===mapping.oldId)
  const character=await connection.call(targetPath('storyboard-character',mapping.slug))
  reconcile(character,{portrait:mapping.portraitAsset,campaign:ids.campaign,account:ids.accounts[mapping.oldOwner],player:ids.members[mapping.oldOwner],legacy_id:source.id,game_data:dataOf(source)},plan,source.name,ids.characters[mapping.oldId])
 }
 const portal=await connection.call(targetPath('storyboard-portal','shinsekai'))
 reconcile(portal,{campaign:ids.campaign,key:'shinsekai',legacy_workspace:plan.workspaceSlug,...portalSchema},plan,'Shinsekai player portal',ids.portal)
 if(!portal.portalSecretConfigured)throw Error('Portal secret not configured')
 for(const p of plan.dependencies)if(sha(await connection.asset(p.asset))!==p.assetHash)throw Error('Portrait bytes changed')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
