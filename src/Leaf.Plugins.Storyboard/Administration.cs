using Leaf.Sdk;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;

// Owner-only, single-record operational configuration. This is a typed SDK
// boundary, not a bulk importer; absent-row CAS and revision CAS are mandatory.
public sealed class StoryAdministration(StoryStore store){
 public async Task<object> EligibilityAsync(string id,JsonObject? input,string actor,CancellationToken ct){
  if(input is null||input.Count!=1||input["canCreate"] is null)throw new StoryException("invalid_json");var eligible=input.Flag("canCreate");
  await store.Commands.WaitAsync(ct);try{await store.WritableAsync(ct);var e=await store.RequireAsync("storyboard-account",id,ct);var saved=await store.ChangeAsync(e.TypeSlug,e.Slug,e.Name,old=>{var next=old!.Data.DeepClone().AsObject();next["can_create"]=eligible;return next;},ct);await store.AuditAsync("account.eligibility",actor,id,ct:ct);return new{id=saved.Id,canCreate=saved.Data.Flag("can_create")};}finally{store.Commands.Release();}
 }
 public static readonly string[] Types=["storyboard-account","storyboard-campaign","storyboard-player","storyboard-character","storyboard-portal"];
 private static void Type(string type){if(!Types.Contains(type))throw new StoryException("unknown_management_type",404);}
 public static object Redacted(LeafEntity e){var data=e.Data.DeepClone().AsObject();var configured=data.Text("portal_secret")!="";data.Remove("portal_secret");return new{id=e.Id,typeSlug=e.TypeSlug,slug=e.Slug,name=e.Name,data,updatedAt=e.UpdatedAt,portalSecretConfigured=configured};}
 public async Task<object> ReadAsync(string type,string slug,CancellationToken ct){Type(type);var e=await store.Entities.GetBySlugAsync(type,slug,ct)??throw new StoryException("not_found",404);await store.CheckProtectionAsync(e,ct);return Redacted(e);}
 public async Task<object> PutAsync(string type,string slug,JsonObject? input,string actor,CancellationToken ct){
  Type(type);if(input is null||input["data"] is not JsonObject fields||input.Any(p=>p.Key is not "name" and not "data" and not "expectedUpdatedAt")||!input.ContainsKey("expectedUpdatedAt"))throw new StoryException("invalid_json");
  if(!System.Text.RegularExpressions.Regex.IsMatch(slug,"^[a-z0-9][a-z0-9-]{0,199}$"))throw new StoryException("invalid_slug");
  var name=StoryJson.Bounded(input.Text("name"),160,true);DateTimeOffset? expected=null;
  if(input["expectedUpdatedAt"] is not null){if(!DateTimeOffset.TryParse(input.Text("expectedUpdatedAt"),System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind,out var date))throw new StoryException("invalid_revision");expected=date;}
  await store.Commands.WaitAsync(ct);try{
   var config=(await store.ConfigAsync(ct))!;if(!config.Data.Flag("writes_fenced"))throw new StoryException("management_writes_require_fence",409);
   if(fields.Any(p=>p.Key is "owner_id" or "owner_agent_id" or "owner_plugin" or "installation" or "confidential" or "proxy_secret"))throw new StoryException("protected_field_forbidden");
   string[] allowed=type switch{
    "storyboard-account"=>["google_issuer","google_subject","email","email_key","avatar","enabled","can_create","legacy_owner","legacy_id"],
    "storyboard-campaign"=>["state","creator","creation_name","workspace","description","summary","summary_stale","cover_asset","revision","archived","game_key","legacy_id"],
    "storyboard-player"=>["account","campaign","role","role_ref","active","present"],
    "storyboard-character"=>["account","campaign","player","portrait","game_data","legacy_id","game_key"],
    _=>["key","campaign","google_client_id","portal_secret","legacy_workspace","portrait_type","character_fields","character_key"]};
   if(fields.ToJsonString().Length>65536||fields.Any(p=>!allowed.Contains(p.Key)&&p.Key is not "parent" and not "migration_run"))throw new StoryException("unknown_management_field");
   foreach(var field in fields){
    if(field.Value is null)throw new StoryException("invalid_json");
    if(field.Key is "enabled" or "can_create" or "archived" or "active" or "summary_stale")fields.Flag(field.Key);
    else if(field.Key=="revision"){if(fields.Number(field.Key)<1||fields.Number(field.Key)>1_000_000_000_000)throw new StoryException("invalid_revision");}
    else if(field.Key is "game_data" or "character_fields"){if(field.Value is not JsonObject)throw new StoryException("invalid_character_data");}
    else StoryJson.Bounded(fields.Text(field.Key),field.Key=="description"?40000:4000);
   }
   var old=await store.Entities.GetBySlugAsync(type,slug,ct);if(old?.UpdatedAt!=expected)throw new StoryException("write_conflict",409);if(old is not null)await store.CheckProtectionAsync(old,ct);
   var data=await store.ProtectAsync(fields.DeepClone().AsObject(),ct);
   if(old is not null){foreach(var key in new[]{"legacy_owner","legacy_id","google_subject","google_issuer","account","campaign","player","game_key","migration_run"})if(!JsonNode.DeepEquals(old.Data[key],data[key]))throw new StoryException("immutable_identity",409);if(type=="storyboard-portal"&&data.Text("portal_secret")=="")data["portal_secret"]=old.Data["portal_secret"]?.DeepClone();}
   if(type=="storyboard-account"){
    var subject=data.Text("google_subject");if(string.IsNullOrWhiteSpace(subject)||subject.Length>255||slug!=StoryAccess.AccountSlug(subject)||data.Text("google_issuer")!="https://accounts.google.com")throw new StoryException("invalid_google_identity");
    if(data.Text("legacy_owner")!=""){StoryJson.Id(data.Text("legacy_owner"));var aliases=await store.AllAsync(type,new Dictionary<string,object?>{["legacy_owner"]=data.Text("legacy_owner")},ct);if(aliases.Any(a=>a.Slug!=slug))throw new StoryException("duplicate_legacy_owner",409);}
   }else if(type=="storyboard-campaign"){
    if(data.Text("state") is not "provisioning" and not "ready"||data.Number("revision")<1)throw new StoryException("invalid_campaign");
    var workspace=await store.Entities.GetAsync(StoryJson.Id(data.Text("workspace")),ct);if(workspace?.TypeSlug!="page")throw new StoryException("invalid_workspace");
    if(data.Text("state")=="ready"&&(await store.AllAsync("storyboard-player",new Dictionary<string,object?>{["campaign"]=old?.Id.ToString()??"",["role"]="gm",["active"]=true},ct)).Count==0)throw new StoryException("last_game_master",409);
   }else if(type=="storyboard-player"){
    await store.RequireAsync("storyboard-campaign",data.Text("campaign"),ct);await store.RequireAsync("storyboard-account",data.Text("account"),ct);
    if(data.Text("role") is not "gm" and not "player"||slug!=StoryCampaigns.PlayerSlug(data.Text("campaign"),data.Text("account")))throw new StoryException("invalid_membership");
    var role=await store.RequireAsync("storyboard-role",data.Text("role_ref"),ct);if(role.Data.Text("key")!=data.Text("role"))throw new StoryException("invalid_role");
    if(old?.Data.Flag("active")==true&&old.Data.Text("role")=="gm"&&(!data.Flag("active")||data.Text("role")!="gm")&&(await store.AllAsync(type,new Dictionary<string,object?>{["campaign"]=data.Text("campaign"),["role"]="gm",["active"]=true},ct)).Count<=1)throw new StoryException("last_game_master",409);
   }else if(type=="storyboard-portal"){
    await store.RequireAsync("storyboard-campaign",data.Text("campaign"),ct);if(data.Text("key")!=slug||!System.Text.RegularExpressions.Regex.IsMatch(slug,"^[a-z][a-z0-9-]{0,62}$")||!StoryPortals.SafeSecret(data.Text("portal_secret"))||string.IsNullOrWhiteSpace(data.Text("google_client_id"))||string.IsNullOrWhiteSpace(data.Text("legacy_workspace")))throw new StoryException("invalid_portal");
    _ = new PortalSchema(data);
   }else{
    var member=await store.RequireAsync("storyboard-player",data.Text("player"),ct);var account=await store.RequireAsync("storyboard-account",data.Text("account"),ct);
    if(member.Data.Text("campaign")!=data.Text("campaign")||member.Data.Text("account")!=account.Id.ToString()||data["game_data"] is not JsonObject)throw new StoryException("invalid_character");
    var portal=await store.Entities.GetBySlugAsync("storyboard-portal",data.Text("game_key"),ct)??throw new StoryException("invalid_portal");await store.CheckProtectionAsync(portal,ct);if(portal.Data.Text("campaign")!=data.Text("campaign"))throw new StoryException("invalid_character");
    var schema=new PortalSchema(portal.Data);var projected=schema.Project(data["game_data"]!.AsObject());schema.Patch(projected);
    if(schema.PortraitKey is not null&&projected.Text(schema.PortraitKey)!=""&&await StoryPortals.PortraitAsync(store,portal,account,projected.Text(schema.PortraitKey),ct)!=data.Text("portrait"))throw new StoryException("portrait_asset_mismatch",409);
    if(data.Text("legacy_id")!=""){
     StoryJson.Id(data.Text("legacy_id"));var aliases=await store.AllAsync(type,new Dictionary<string,object?>{["legacy_id"]=data.Text("legacy_id")},ct);if(aliases.Any(e=>e.Slug!=slug))throw new StoryException("duplicate_character_alias",409);

    }
   }
   var saved=await store.Entities.CompareExchangeBySlugAsync(type,slug,name,data,expected,ct)??throw new StoryException("write_conflict",409);
   await store.AuditAsync("management.entity.saved",actor,saved.Id.ToString(),new JsonObject{["type"]=type},ct);return Redacted(saved);
  }finally{store.Commands.Release();}
 }
 public async Task<object> FenceAsync(bool fenced,string actor,CancellationToken ct){await store.Commands.WaitAsync(ct);try{var e=await store.ChangeAsync("storyboard-config","settings","Storyboard settings",old=>{var data=old!.Data.DeepClone().AsObject();data["writes_fenced"]=fenced;return data;},ct);await store.AuditAsync("settings.fence",actor,e.Id.ToString(),new JsonObject{["writesFenced"]=fenced},ct);return new{writesFenced=e.Data.Flag("writes_fenced")};}finally{store.Commands.Release();}}
}
