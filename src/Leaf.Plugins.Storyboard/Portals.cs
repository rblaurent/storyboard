using Leaf.Sdk;
using Leaf.Sdk.Services;
using Microsoft.AspNetCore.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Leaf.Plugins.Storyboard;

// Delegation is confined to one registered campaign. No account directory or
// legacy account write API is exposed to a portal server.
public sealed class StoryPortals(StoryStore store,StoryCampaigns campaigns,StoryAccess access,IGoogleIdentity google) {
 public static bool SafeSecret(string value)=>Regex.IsMatch(value,"^[A-Za-z0-9_-]{43}$")&&Convert.ToBase64String(Convert.FromBase64String(value.Replace('-','+').Replace('_','/')+"=")).TrimEnd('=').Replace('+','-').Replace('/','_')==value;
 public async Task<LeafEntity> AuthorizeAsync(string key,HttpContext h,IAuthContext auth,CancellationToken ct=default){
  if(string.IsNullOrWhiteSpace(auth.UserId))throw new StoryException("leaf_authentication_required",401);
  if(!Regex.IsMatch(key,"^[a-z][a-z0-9-]{0,62}$"))throw new StoryException("portal_access_denied",403);
  var p=await store.Entities.GetBySlugAsync("storyboard-portal",key,ct);
  var supplied=h.Request.Headers["X-Storyboard-Portal-Key"].ToString();
  if(p is null||p.Data.Text("key")!=key||!SafeSecret(p.Data.Text("portal_secret"))||!SafeSecret(supplied)||!StoryJson.Equal(p.Data.Text("portal_secret"),supplied))throw new StoryException("portal_access_denied",403);
  await store.CheckProtectionAsync(p,ct);var c=await store.RequireAsync("storyboard-campaign",p.Data.Text("campaign"),ct);
  if(c.Data.Text("state")!="ready"||string.IsNullOrWhiteSpace(p.Data.Text("google_client_id"))||string.IsNullOrWhiteSpace(p.Data.Text("legacy_workspace")))throw new StoryException("portal_not_configured",503);
  _ = new PortalSchema(p.Data);return p;
 }
 public async Task<object> IdentityAsync(LeafEntity portal,JsonObject? input,CancellationToken ct=default){
  if(input is null||input.Any(p=>p.Key is not "idToken" and not "nonce"))throw new StoryException("invalid_json");
  var token=StoryJson.Bounded(input.Text("idToken"),16384,true);var nonce=StoryJson.Bounded(input.Text("nonce"),512,true);
  var identity=await google.ValidateAsync(token,nonce,portal.Data.Text("google_client_id"),ct);
  await store.Commands.WaitAsync(ct);try{
   await store.WritableAsync(ct);var current=await store.RequireAsync("storyboard-portal",portal.Id.ToString(),ct);if(current.UpdatedAt!=portal.UpdatedAt)throw new StoryException("portal_configuration_changed",409);await store.CheckProtectionAsync(portal,ct);
   var prior=await store.Entities.GetBySlugAsync("storyboard-account",StoryAccess.AccountSlug(identity.Subject),ct);
   if(prior is not null){await store.CheckProtectionAsync(prior,ct);var priorMember=await store.Entities.GetBySlugAsync("storyboard-player",StoryCampaigns.PlayerSlug(portal.Data.Text("campaign"),prior.Id.ToString()),ct);if(priorMember is not null&&!priorMember.Data.Flag("active"))throw new StoryException("campaign_access_denied",403);if(priorMember is null&&prior.Data.Text("enrollment_campaign")!=portal.Data.Text("campaign"))throw new StoryException("campaign_access_denied",403);}
   var a=await access.AccountCoreAsync(identity.Subject,identity.Email,identity.Name,identity.Avatar,ct,enrollmentCampaign:portal.Data.Text("campaign"));
   if(!a.Data.Flag("enabled"))throw new StoryException("account_disabled",403);
   var campaign=await store.RequireAsync("storyboard-campaign",portal.Data.Text("campaign"),ct);
   var slug=StoryCampaigns.PlayerSlug(campaign.Id.ToString(),a.Id.ToString());
   var member=await store.Entities.GetBySlugAsync("storyboard-player",slug,ct);
   if(member is not null){await store.CheckProtectionAsync(member,ct);if(!member.Data.Flag("active"))throw new StoryException("campaign_access_denied",403);}
   else{
    var role=await store.Entities.GetBySlugAsync("storyboard-role","player",ct)??throw new StoryException("roles_not_configured",503);
    var data=await store.ProtectAsync(new JsonObject{["campaign"]=campaign.Id.ToString(),["account"]=a.Id.ToString(),["role"]="player",["role_ref"]=role.Id.ToString(),["active"]=true,["parent"]=campaign.Data.Text("workspace")},ct);
    member=await store.ChangeAsync("storyboard-player",slug,"Campaign member",old=>old?.Data.DeepClone().AsObject()??data.DeepClone().AsObject(),ct);
   }
   await campaigns.MembershipAsync(campaign.Id.ToString(),a.Id.ToString(),ct:ct);
   await store.AuditAsync("portal.signed_in",a.Id.ToString(),portal.Id.ToString(),ct:ct);
   return new{accountId=a.Id,ownerId=Owner(a),email=a.Data.Text("email"),name=a.Name,avatar=a.Data.Text("avatar"),role=member.Data.Text("role")};
  }finally{store.Commands.Release();}
 }
 public static string Owner(LeafEntity a)=>a.Data.Text("legacy_owner")==""?a.Id.ToString():StoryJson.Id(a.Data.Text("legacy_owner")).ToString();
 public async Task<LeafEntity> ActorAsync(LeafEntity portal,string owner,CancellationToken ct=default){
  var id=StoryJson.Id(owner).ToString();var direct=await store.Entities.GetAsync(Guid.Parse(id),ct);
  var candidates=await store.AllAsync("storyboard-account",new Dictionary<string,object?>{["legacy_owner"]=id},ct);
  if(direct?.TypeSlug=="storyboard-account")candidates.Add(direct);
  var unique=candidates.DistinctBy(a=>a.Id).ToArray();if(unique.Length!=1)throw new StoryException("campaign_access_denied",403);
  var a=unique[0];await store.CheckProtectionAsync(a,ct);await campaigns.MembershipAsync(portal.Data.Text("campaign"),a.Id.ToString(),ct:ct);return a;
 }
 private async Task<List<LeafEntity>> OwnedAsync(LeafEntity portal,LeafEntity actor,CancellationToken ct){
  var m=await campaigns.MembershipAsync(portal.Data.Text("campaign"),actor.Id.ToString(),ct:ct);
  return (await store.AllAsync("storyboard-character",new Dictionary<string,object?>{["campaign"]=portal.Data.Text("campaign"),["player"]=m.Id.ToString()},ct)).Where(c=>c.Data.Text("account")==actor.Id.ToString()).ToList();
 }
 public object Projection(LeafEntity portal,LeafEntity actor,LeafEntity character){
  var data=new PortalSchema(portal.Data).Project(character.Data["game_data"] as JsonObject??new JsonObject());
  data["account"]=Owner(actor);data["parent"]=portal.Data.Text("legacy_workspace");
  return new{id=character.Id,typeSlug="storyboard-character",name=character.Name,slug=character.Slug,data};
 }
 public async Task<object> ListAsync(LeafEntity portal,string owner,CancellationToken ct=default){var actor=await ActorAsync(portal,owner,ct);var chars=await OwnedAsync(portal,actor,ct);return new{items=chars.Select(c=>Projection(portal,actor,c)),total=chars.Count};}
 private async Task<LeafEntity> CharacterAsync(LeafEntity portal,LeafEntity actor,string id,CancellationToken ct){
  id=StoryJson.Id(id).ToString();var matches=(await OwnedAsync(portal,actor,ct)).Where(c=>c.Id.ToString()==id||c.Data.Text("legacy_id")==id).ToArray();
  if(matches.Length!=1)throw new StoryException("not_found",404);await store.CheckProtectionAsync(matches[0],ct);return matches[0];
 }
 public async Task<object> GetAsync(LeafEntity portal,string owner,string id,CancellationToken ct=default){var a=await ActorAsync(portal,owner,ct);return Projection(portal,a,await CharacterAsync(portal,a,id,ct));}
 internal static async Task<string> PortraitAsync(StoryStore store,LeafEntity portal,LeafEntity actor,string id,CancellationToken ct){
  var e=await store.Entities.GetAsync(StoryJson.Id(id),ct);
  if(e?.TypeSlug!=new PortalSchema(portal.Data).PortraitType||e.Data.Text("parent")!=portal.Data.Text("legacy_workspace")||e.Data.Text("account")!=""&&e.Data.Text("account")!=Owner(actor))throw new StoryException("portrait_access_denied",403);
  var url=e.Data.Text("image_url");if(!Uri.TryCreate(url,UriKind.RelativeOrAbsolute,out var uri))throw new StoryException("portrait_unavailable",409);
  if(uri.IsAbsoluteUri){if(uri.Scheme is not "http" and not "https"||!uri.IsLoopback||uri.UserInfo!=""||uri.Query!=""||uri.Fragment!="")throw new StoryException("portrait_unavailable",409);url=uri.AbsolutePath;}
  var match=Regex.Match(url,"^/api/assets/([a-fA-F0-9-]{36}\\.(?:png|webp|jpg|jpeg))$");if(!match.Success||!Guid.TryParse(Path.GetFileNameWithoutExtension(match.Groups[1].Value),out _))throw new StoryException("portrait_unavailable",409);return match.Groups[1].Value;
 }
 public async Task<object> WriteAsync(LeafEntity portal,string owner,string? id,JsonObject? input,CancellationToken ct=default){
  if(input is null||input.Any(p=>p.Key is not "name" and not "data" and not "operationId")||input["data"] is not null&&input["data"] is not JsonObject)throw new StoryException("invalid_json");
  var schema=new PortalSchema(portal.Data);var patch=schema.Patch(input["data"] as JsonObject??new JsonObject());var name=input.ContainsKey("name")?StoryJson.Bounded(input.Text("name"),160,true):null;
  await store.Commands.WaitAsync(ct);try{
   await store.WritableAsync(ct);var actor=await ActorAsync(portal,owner,ct);await store.CheckProtectionAsync(portal,ct);if((await store.RequireAsync("storyboard-portal",portal.Id.ToString(),ct)).UpdatedAt!=portal.UpdatedAt)throw new StoryException("portal_configuration_changed",409);
   var member=await campaigns.MembershipAsync(portal.Data.Text("campaign"),actor.Id.ToString(),ct:ct);
   LeafEntity? old=id is null?null:await CharacterAsync(portal,actor,id,ct);
   if(id is null){
    if(name is null)throw new StoryException("character_name_required");
    if(schema.StableKey!=""){if(string.IsNullOrWhiteSpace(patch.Text(schema.StableKey)))throw new StoryException("character_key_required");}
    else StoryJson.Id(input.Text("operationId"));
    var existing=await OwnedAsync(portal,actor,ct);if(existing.Count>1)throw new StoryException("character_reconciliation_required",409);
    if(existing.Count==1){var existingGame=existing[0].Data["game_data"] as JsonObject;if(existing[0].Name!=name||(schema.StableKey!=""?existingGame?.Text(schema.StableKey)!=patch.Text(schema.StableKey):existing[0].Data.Text("creation_operation")!=input.Text("operationId"))||patch.Any(p=>!JsonNode.DeepEquals(existingGame?[p.Key],p.Value)))throw new StoryException("character_already_exists",409);return Projection(portal,actor,existing[0]);}
   }
   if(old is not null&&schema.StableKey!=""&&patch.ContainsKey(schema.StableKey)&&(old.Data["game_data"] as JsonObject)?.Text(schema.StableKey)!=patch.Text(schema.StableKey))throw new StoryException("immutable_character_key",409);
   var portrait=schema.PortraitKey is not null&&patch.ContainsKey(schema.PortraitKey)?await PortraitAsync(store,portal,actor,patch.Text(schema.PortraitKey),ct):old?.Data.Text("portrait")??"";
   var initial=await store.ProtectAsync(new JsonObject{["account"]=actor.Id.ToString(),["player"]=member.Id.ToString(),["campaign"]=portal.Data.Text("campaign"),["parent"]=portal.Data.Text("legacy_workspace"),["game_key"]=portal.Data.Text("key"),["creation_operation"]=input.Text("operationId"),["game_data"]=new JsonObject()},ct);
   var saved=await store.ChangeAsync("storyboard-character",old?.Slug??"char-"+StoryJson.Hash(portal.Data.Text("campaign")+"|"+actor.Id),name??old!.Name,e=>{var data=e?.Data.DeepClone().AsObject()??initial.DeepClone().AsObject();var game=(data["game_data"] as JsonObject)?.DeepClone().AsObject()??new JsonObject();foreach(var p in patch)game[p.Key]=p.Value?.DeepClone();data["game_data"]=game;data["portrait"]=portrait;return data;},ct);
   await store.AuditAsync(old is null?"character.created":"character.updated",actor.Id.ToString(),saved.Id.ToString(),ct:ct);return Projection(portal,actor,saved);
  }finally{store.Commands.Release();}
 }
}
