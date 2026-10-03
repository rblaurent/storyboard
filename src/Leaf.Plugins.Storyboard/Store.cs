using Leaf.Sdk;
using Leaf.Sdk.Services;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;
public sealed class StoryStore(IEntityStore entities,IRecordStreams records) {
 public SemaphoreSlim Commands {get;}=new(1,1);
 public async Task WritableAsync(CancellationToken ct=default){if((await ConfigAsync(ct))?.Data.Flag("writes_fenced")==true)throw new StoryException("writes_fenced",503);}
 public async Task CheckProtectionAsync(LeafEntity e,CancellationToken ct=default){var c=await ConfigAsync(ct)??throw new StoryException("storyboard_not_configured",503);if(!e.Data.Flag("confidential")||e.Data.Text("owner_id")!=c.Data.Text("owner_id")||!Guid.TryParse(e.Data.Text("owner_agent_id"),out _)||e.Data.Text("owner_agent_id")!=c.Data.Text("owner_agent_id")||e.Data.Text("installation")!=c.Data.Text("installation"))throw new StoryException("not_found",404);}
 public async Task<IReadOnlyList<LeafEntity>> ProvisionAgentsAsync(string owner,CancellationToken ct=default)=> (await entities.QueryAsync(new EntityQuery{TypeSlug="agent",Limit=500},ct)).Where(e=>!e.Data.Flag("confidential")||e.Data.Text("owner_id")==owner).ToArray();
 public IEntityStore Entities=>entities;
 public Task<LeafEntity?> ConfigAsync(CancellationToken ct=default)=>entities.GetBySlugAsync("storyboard-config","settings",ct);
 public async Task<LeafEntity> ChangeAsync(string type,string slug,string name,Func<LeafEntity?,JsonObject> write,CancellationToken ct=default) {
  for(var n=0;n<12;n++){var old=await entities.GetBySlugAsync(type,slug,ct);var data=write(old);if(type.StartsWith("storyboard-")){var c=await ConfigAsync(ct);if(!data.Flag("confidential")||string.IsNullOrWhiteSpace(data.Text("owner_id"))||!Guid.TryParse(data.Text("owner_agent_id"),out _)||!Guid.TryParse(data.Text("installation"),out _)||c is not null&&(data.Text("owner_id")!=c.Data.Text("owner_id")||data.Text("owner_agent_id")!=c.Data.Text("owner_agent_id")||data.Text("installation")!=c.Data.Text("installation")))throw new StoryException("invalid_entity_protection",409);if(old is not null){foreach(var key in new[]{"owner_id","owner_agent_id","installation","legacy_owner","legacy_id"})if(!System.Text.Json.Nodes.JsonNode.DeepEquals(old.Data[key],data[key]))throw new StoryException("immutable_identity",409);}}var saved=await entities.CompareExchangeBySlugAsync(type,slug,name,data,old?.UpdatedAt,ct);if(saved is not null)return saved;await Task.Delay(5*(n+1),ct);}throw new StoryException("write_conflict",409);
 }
 public async Task<LeafEntity> RequireAsync(string type,string id,CancellationToken ct=default) {
  var e=await entities.GetAsync(StoryJson.Id(id),ct);var c=await ConfigAsync(ct)??throw new StoryException("storyboard_not_configured",503);
  if(e is null||e.TypeSlug!=type)throw new StoryException("not_found",404);await CheckProtectionAsync(e,ct);return e;
 }
 public async Task<List<LeafEntity>> AllAsync(string type,IReadOnlyDictionary<string,object?>? filters=null,CancellationToken ct=default) {
  var c=await ConfigAsync(ct)??throw new StoryException("storyboard_not_configured",503);
  var match=new Dictionary<string,object?>(filters??new Dictionary<string,object?>()){["installation"]=c.Data.Text("installation"),["owner_id"]=c.Data.Text("owner_id"),["owner_agent_id"]=c.Data.Text("owner_agent_id"),["confidential"]=true};
  List<LeafEntity> result=[];Guid? cursor=null;
  do{var page=await entities.QueryAsync(new EntityQuery{TypeSlug=type,DataEquals=match,Limit=500,OrderById=true,AfterId=cursor},ct);result.AddRange(page);if(page.Count<500)break;cursor=page[^1].Id;}while(true);return result;
 }
 public async Task<JsonObject> ProtectAsync(JsonObject data,CancellationToken ct=default) {
  var c=await ConfigAsync(ct)??throw new StoryException("storyboard_not_configured",503);
  data["installation"]=c.Data.Text("installation");data["confidential"]=true;data["owner_id"]=c.Data.Text("owner_id");data["owner_agent_id"]=c.Data.Text("owner_agent_id");data["parent"]??=c.Data.Text("workspace");return data;
 }
 public async Task ProvisionAsync(string owner,CancellationToken ct=default,string? ownerAgentId=null) {
  await Commands.WaitAsync(ct);try{
  if(!Guid.TryParseExact(owner,"D",out var ownerId)||ownerId==Guid.Empty)throw new StoryException("leaf_administrator_required",403);
  var c=await ConfigAsync(ct);if(c is not null){if(c.Data.Text("owner_id")!=owner)throw new StoryException("extension_owner_required",403);}
  else {
   var agents=await ProvisionAgentsAsync(owner,ct);var agent=ownerAgentId is null?agents.Count==1?agents[0]:null:agents.SingleOrDefault(a=>a.Id==StoryJson.Id(ownerAgentId));if(agent is null)throw new StoryException("owning_agent_required",400);ownerAgentId=agent.Id.ToString();
   var root=await ChangeAsync("page","storyboard-workspace","Storyboard",old=>{if(old is not null&&(old.Data.Text("owner_id")!=owner||old.Data.Text("owner_agent_id")!=ownerAgentId||!old.Data.Flag("confidential")))throw new StoryException("owner_binding_conflict",409);return old?.Data.DeepClone().AsObject()??new JsonObject{["owner_id"]=owner,["confidential"]=true,["owner_agent_id"]=ownerAgentId,["icon"]="ph-bold ph-film-strip",["description"]="Storyboard accounts and configuration."};},ct);
   await ChangeAsync("storyboard-config","settings","Storyboard settings",old=>{if(old is not null&&old.Data.Text("owner_id")!=owner)throw new StoryException("extension_owner_required",403);return old?.Data.DeepClone().AsObject()??new JsonObject{["owner_id"]=owner,["owner_agent_id"]=ownerAgentId,["confidential"]=true,["workspace"]=root.Id.ToString(),["parent"]=root.Id.ToString(),["installation"]=root.Id.ToString(),["public_url"]="",["fast_quality_mode"]="fast",["quality_mode"]="deep",["workflow"]="z_turbo",["visual_brief"]="Cinematic campaign artwork, clear composition, no lettering.",["proxy_secret"]=StoryJson.Token()};},ct);
  }
  foreach(var role in new[]{"gm","player"}){var data=await ProtectAsync(new JsonObject{["key"]=role,["permissions"]=JsonSerializerNode(role)},ct);await ChangeAsync("storyboard-role",role,role=="gm"?"Game Master":"Player",old=>old?.Data.DeepClone().AsObject()??data.DeepClone().AsObject(),ct);}
  }finally{Commands.Release();}
 }
 private static JsonArray JsonSerializerNode(string role)=>new((role=="gm"?new[]{"read","edit","players","generate","archive"}:new[]{"read"}).Select(s=>(JsonNode?)JsonValue.Create(s)).ToArray());
 public Task AuditAsync(string action,string actor,string target,JsonObject? details=null,CancellationToken ct=default)=>records.AppendAsync("audit",new JsonObject{["action"]=action,["actor"]=actor,["target"]=target,["outcome"]=details?.Text("outcome","succeeded")??"succeeded",["details"]=details?.DeepClone()},Guid.TryParse(target,out var id)?id:null,null,ct);
 public Task<IReadOnlyList<LeafRecord>> AuditListAsync(CancellationToken ct=default)=>records.QueryAsync("audit",new RecordQuery{Limit=100},ct);
}
