using Leaf.Sdk;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;
public sealed class StoryCampaigns(StoryStore store) {
 private SemaphoreSlim gate=>store.Commands;
 public static string PlayerSlug(string campaign,string account)=>"m-"+StoryJson.Hash(campaign+":"+account);
 public async Task<LeafEntity> MembershipAsync(string campaign,string account,bool gm=false,CancellationToken ct=default) {
  var a=await store.RequireAsync("storyboard-account",account,ct);if(!a.Data.Flag("enabled"))throw new StoryException("account_disabled",403);
  var m=await store.Entities.GetBySlugAsync("storyboard-player",PlayerSlug(campaign,account),ct);
  if(m is null||!m.Data.Flag("active")||m.Data.Text("campaign")!=campaign||m.Data.Text("account")!=account)throw new StoryException("campaign_access_denied",403);
  await store.CheckProtectionAsync(m,ct);await store.RequireAsync("storyboard-campaign",campaign,ct);if(gm&&m.Data.Text("role")!="gm")throw new StoryException("game_master_required",403);return m;
 }
 public async Task<LeafEntity> CreateAsync(string accountId,CreateCampaign input,CancellationToken ct=default) {
  if(input is null)throw new StoryException("invalid_json");var a=await store.RequireAsync("storyboard-account",accountId,ct);if(!a.Data.Flag("enabled")||!a.Data.Flag("can_create"))throw new StoryException("campaign_creation_not_enabled",403);
  var name=StoryJson.Bounded(input.Name,120,true);var slug="c-"+StoryJson.Hash(accountId+":"+StoryJson.Id(input.OperationId).ToString("N"));
  await gate.WaitAsync(ct);try {
   await store.WritableAsync(ct);a=await store.RequireAsync("storyboard-account",accountId,ct);if(!a.Data.Flag("enabled")||!a.Data.Flag("can_create"))throw new StoryException("campaign_creation_not_enabled",403);
   var data=await store.ProtectAsync(new JsonObject{["state"]="provisioning",["creator"]=accountId,["creation_name"]=name,["description"]="",["summary"]="",["revision"]=1,["archived"]=false},ct);
   var campaign=await store.ChangeAsync("storyboard-campaign",slug,name,old=>{if(old is not null&&old.Data.Text("creation_name")!=name)throw new StoryException("operation_reused",409);return old?.Data.DeepClone().AsObject()??data.DeepClone().AsObject();},ct);
   if(campaign.Data.Text("state")=="ready")return campaign;
   var wd=await store.ProtectAsync(new JsonObject{["campaign"]=campaign.Id.ToString(),["icon"]="ph-bold ph-film-strip",["description"]="Campaign workspace."},ct);
   var w=await store.ChangeAsync("page",slug+"-workspace",name,old=>old?.Data.DeepClone().AsObject()??wd.DeepClone().AsObject(),ct);
   await SetCoreAsync(campaign.Id.ToString(),accountId,"gm",w.Id.ToString(),ct);
   var ready=await store.ChangeAsync(campaign.TypeSlug,slug,campaign.Name,old=>{var next=old!.Data.DeepClone().AsObject();next["workspace"]=w.Id.ToString();next["state"]="ready";return next;},ct);
   await store.AuditAsync("campaign.created",accountId,ready.Id.ToString(),ct:ct);return ready;
  }finally{gate.Release();}
 }
 public async Task<object> ProjectionAsync(LeafEntity e,string account,CancellationToken ct=default) {
  var member=await MembershipAsync(e.Id.ToString(),account,ct:ct);
  var members=await store.AllAsync("storyboard-player",new Dictionary<string,object?>{["campaign"]=e.Id.ToString(),["active"]=true},ct);
  var avatars=new List<object>();foreach(var p in members.Take(6)){var a=await store.RequireAsync("storyboard-account",p.Data.Text("account"),ct);avatars.Add(new{id=a.Id,name=a.Name,avatar=a.Data.Text("avatar")});}
  return new{id=e.Id,name=e.Name,description=e.Data.Text("description"),summary=e.Data.Text("summary"),summaryStale=e.Data.Flag("summary_stale"),image=e.Data.Text("cover_asset")==""?null:"/api/campaigns/"+e.Id+"/media/cover",archived=e.Data.Flag("archived"),revision=e.Data.Number("revision"),role=member.Data.Text("role"),playerCount=members.Count,players=avatars};
 }
 public async Task<List<object>> ListAsync(string account,bool archived,CancellationToken ct=default) {
  List<object> result=[];foreach(var m in await store.AllAsync("storyboard-player",new Dictionary<string,object?>{["account"]=account,["active"]=true},ct)){var c=await store.RequireAsync("storyboard-campaign",m.Data.Text("campaign"),ct);if(c.Data.Text("state")!="ready"||!archived&&c.Data.Flag("archived"))continue;result.Add(await ProjectionAsync(c,account,ct));}return result;
 }
 public async Task<LeafEntity> SaveAsync(string id,string account,CampaignWrite input,CancellationToken ct=default) {
  await gate.WaitAsync(ct);try {
  await store.WritableAsync(ct);
  if(input is null)throw new StoryException("invalid_json");if(input.ExpectedRevision<1)throw new StoryException("invalid_revision");await MembershipAsync(id,account,true,ct);var e=await store.RequireAsync("storyboard-campaign",id,ct);var name=StoryJson.Bounded(input.Name,120,true);var description=StoryJson.Bounded(input.Description,40000);var summary=StoryJson.Bounded(input.Summary,1500);
  var saved=await store.ChangeAsync(e.TypeSlug,e.Slug,name,old=>{if(old!.Data.Number("revision")!=input.ExpectedRevision)throw new StoryException("campaign_changed",409);var next=old.Data.DeepClone().AsObject();next["summary_stale"]=next.Text("summary")==summary&&(next.Flag("summary_stale")||next.Text("description")!=description);next["description"]=description;next["summary"]=summary;next["revision"]=input.ExpectedRevision+1;return next;},ct);
  await store.AuditAsync("campaign.updated",account,id,ct:ct);return saved;
  }finally{gate.Release();}
 }
 public async Task<LeafEntity> ArchiveAsync(string id,string account,bool archive,CancellationToken ct=default) {
  await gate.WaitAsync(ct);try {
  await store.WritableAsync(ct);
  await MembershipAsync(id,account,true,ct);var e=await store.RequireAsync("storyboard-campaign",id,ct);
  var saved=await store.ChangeAsync(e.TypeSlug,e.Slug,e.Name,old=>{var next=old!.Data.DeepClone().AsObject();next["archived"]=archive;next["revision"]=next.Number("revision")+1;return next;},ct);
  await store.AuditAsync(archive?"campaign.archived":"campaign.restored",account,id,ct:ct);return saved;
  }finally{gate.Release();}
 }
 private async Task<LeafEntity> SetCoreAsync(string campaign,string account,string role,string workspace,CancellationToken ct) {
  if(role is not "gm" and not "player")throw new StoryException("invalid_role");
  var definition=await store.Entities.GetBySlugAsync("storyboard-role",role,ct)??throw new StoryException("roles_not_configured",503);
  var data=await store.ProtectAsync(new JsonObject{["account"]=account,["campaign"]=campaign,["role"]=role,["role_ref"]=definition.Id.ToString(),["active"]=true,["present"]=true,["parent"]=workspace},ct);
  return await store.ChangeAsync("storyboard-player",PlayerSlug(campaign,account),"Campaign member",old=>{var next=old?.Data.DeepClone().AsObject()??data.DeepClone().AsObject();if(old is null||!old.Data.Flag("active"))next["present"]=true;next["role"]=role;next["role_ref"]=definition.Id.ToString();next["active"]=true;return next;},ct);
 }
 private async Task CheckLastGmAsync(string campaign,CancellationToken ct) {if((await store.AllAsync("storyboard-player",new Dictionary<string,object?>{["campaign"]=campaign,["role"]="gm",["active"]=true},ct)).Count<=1)throw new StoryException("last_game_master",409);}
 public async Task SetMemberAsync(string campaign,string actor,MembershipWrite input,CancellationToken ct=default) {
  await gate.WaitAsync(ct);try{
   await store.WritableAsync(ct);
   if(input is null)throw new StoryException("invalid_json");if(input.Role is not "gm" and not "player")throw new StoryException("invalid_role");await MembershipAsync(campaign,actor,true,ct);var target=await store.RequireAsync("storyboard-account",input.AccountId,ct);if(!target.Data.Flag("enabled"))throw new StoryException("account_disabled",403);
   var old=await store.Entities.GetBySlugAsync("storyboard-player",PlayerSlug(campaign,input.AccountId),ct);
   if(old?.Data.Flag("active")==true&&old.Data.Text("role")=="gm"&&input.Role!="gm")await CheckLastGmAsync(campaign,ct);
   var c=await store.RequireAsync("storyboard-campaign",campaign,ct);var m=await SetCoreAsync(campaign,input.AccountId,input.Role,c.Data.Text("workspace"),ct);await store.AuditAsync("player.updated",actor,m.Id.ToString(),ct:ct);
  }finally{gate.Release();}
 }
 public async Task RemoveMemberAsync(string campaign,string actor,string memberId,CancellationToken ct=default) {
  await gate.WaitAsync(ct);try{
   await store.WritableAsync(ct);
   await MembershipAsync(campaign,actor,true,ct);var e=await store.RequireAsync("storyboard-player",memberId,ct);if(e.Data.Text("campaign")!=campaign)throw new StoryException("not_found",404);
   if(e.Data.Flag("active")&&e.Data.Text("role")=="gm")await CheckLastGmAsync(campaign,ct);
   await store.ChangeAsync(e.TypeSlug,e.Slug,e.Name,old=>{var next=old!.Data.DeepClone().AsObject();next["active"]=false;return next;},ct);await store.AuditAsync("player.removed",actor,memberId,ct:ct);
  }finally{gate.Release();}
 }
 public async Task SetPresenceAsync(string campaign,string actor,string memberId,PresenceWrite input,CancellationToken ct=default) {
  await gate.WaitAsync(ct);try{
   await store.WritableAsync(ct);if(input is null)throw new StoryException("invalid_json");await MembershipAsync(campaign,actor,true,ct);var member=await store.RequireAsync("storyboard-player",memberId,ct);
   if(member.Data.Text("campaign")!=campaign||!member.Data.Flag("active"))throw new StoryException("not_found",404);
   await store.ChangeAsync(member.TypeSlug,member.Slug,member.Name,old=>{var next=old!.Data.DeepClone().AsObject();next["present"]=input.Present;return next;},ct);
   await store.AuditAsync(input.Present?"player.present":"player.absent",actor,memberId,ct:ct);
  }finally{gate.Release();}
 }
 public async Task<List<object>> PlayersAsync(string campaign,string actor,CancellationToken ct=default) {
  await MembershipAsync(campaign,actor,ct:ct);List<object> result=[];
  foreach(var m in await store.AllAsync("storyboard-player",new Dictionary<string,object?>{["campaign"]=campaign,["active"]=true},ct)){
   var a=await store.RequireAsync("storyboard-account",m.Data.Text("account"),ct);var chars=await store.AllAsync("storyboard-character",new Dictionary<string,object?>{["campaign"]=campaign,["player"]=m.Id.ToString()},ct);
   result.Add(new{id=m.Id,accountId=a.Id,name=a.Name,avatar=a.Data.Text("avatar"),role=m.Data.Text("role"),present=!m.Data.ContainsKey("present")||m.Data.Flag("present"),characters=chars.Select(c=>new{id=c.Id,name=c.Name,portrait=c.Data.Text("portrait")==""?null:"/api/campaigns/"+campaign+"/media/characters/"+c.Id})});
  }return result;
 }
}
