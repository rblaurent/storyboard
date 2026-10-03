using Leaf.Sdk.Services;
using Microsoft.AspNetCore.Http;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;
public sealed class StorySettings(StoryStore store,IHttpContextAccessor? contexts=null):IPluginSettingsProvider {
 public string PluginId=>"storyboard";
 public async Task RequireOwnerAsync(string? user,CancellationToken ct=default){
  var c=await store.ConfigAsync(ct);if(string.IsNullOrWhiteSpace(user)||c?.Data.Text("owner_id")!=user)throw new StoryException("extension_owner_required",403);
  // IAuthContext supplies the signed subject. Host-validated execution claims
  // additionally bind privileged SDK access to the configured owning Agent.
  if(contexts?.HttpContext is { } h){
   if(h.User.Identity?.IsAuthenticated!=true||h.User.Identity.AuthenticationType=="LocalDefault")throw new StoryException("extension_owner_required",403);
   if(h.User.FindFirst("token_use")?.Value=="execution"){
    JsonObject? identity;try{identity=System.Text.Json.Nodes.JsonNode.Parse(h.User.FindFirst("execution_identity")?.Value??"null") as JsonObject;}catch(System.Text.Json.JsonException){throw new StoryException("extension_owner_required",403);}
    if(identity?["actor"] is not JsonObject actor||identity["beneficiary"] is not JsonObject beneficiary||actor.Text("kind")!="agent"||actor.Text("entityId",actor.Text("id"))!=c.Data.Text("owner_agent_id")||beneficiary.Text("kind")!="user"||beneficiary.Text("id")!=user)throw new StoryException("extension_owner_required",403);
   }
  }
 }
 public async Task<JsonObject> DescribeAsync(string? user,CancellationToken ct=default) {
  try{await RequireOwnerAsync(user,ct);}catch(StoryException e){return new JsonObject{["id"]=PluginId,["sections"]=new JsonArray(),["error"]=e.Code};}var c=(await store.ConfigAsync(ct))!;
  JsonObject Field(string key,string label,string type="string")=>new(){["key"]=key,["path"]=key,["label"]=label,["type"]=type,["value"]=type=="secret"?null:c.Data[key]?.DeepClone(),["configured"]=!string.IsNullOrWhiteSpace(c.Data.Text(key)),["protection"]=type=="secret"?"encrypted":null};
  return new JsonObject{["id"]=PluginId,["sections"]=new JsonArray{
   new JsonObject{["id"]="access",["name"]="Public access",["fields"]=new JsonArray{Field("public_url","Public website"),Field("google_client_id","Google client ID"),Field("google_client_secret","Google client secret","secret"),Field("proxy_secret","Site connection key","secret")}},
   new JsonObject{["id"]="generation",["name"]="Generation",["fields"]=new JsonArray{Field("quality_mode","Text quality mode"),Field("workflow","Image workflow"),Field("visual_brief","Default visual brief")}}}};
 }
 public async Task<JsonObject> WriteAsync(string? user,string section,JsonObject values,bool validateOnly,CancellationToken ct=default){
  try{return await WriteCoreAsync(user,section,values,validateOnly,ct);}catch(StoryException e){if(e.Status==400)throw new ArgumentException(e.Code);throw new InvalidOperationException(e.Code);}
 }
 private async Task<JsonObject> WriteCoreAsync(string? user,string section,JsonObject values,bool validateOnly,CancellationToken ct){
  await RequireOwnerAsync(user,ct);string[] allowed=section switch{"access"=>["public_url","google_client_id","google_client_secret","proxy_secret"],"generation"=>["quality_mode","workflow","visual_brief"],_=>throw new StoryException("unknown_settings_section")};
  foreach(var p in values){if(!allowed.Contains(p.Key)||p.Value is not JsonValue)throw new StoryException("unknown_setting");StoryJson.Bounded(values.Text(p.Key),p.Key=="visual_brief"?4000:1000);}
  if(values["public_url"] is not null)values["public_url"]=StoryJson.Origin(values.Text("public_url"));
  if(values["proxy_secret"] is not null&&values.Text("proxy_secret").Length<32)throw new StoryException("invalid_connection_key");
  if(!validateOnly){await store.Commands.WaitAsync(ct);try{await RequireOwnerAsync(user,ct);await store.ChangeAsync("storyboard-config","settings","Storyboard settings",old=>{var next=old!.Data.DeepClone().AsObject();foreach(var p in values)if(p.Value is not null&&!string.IsNullOrEmpty(p.Value.GetValue<string>()))next[p.Key]=p.Value.DeepClone();return next;},ct);await store.AuditAsync("settings.updated",user!,"settings",new JsonObject{["section"]=section},ct);}finally{store.Commands.Release();}}return new JsonObject{["ok"]=true,["validateOnly"]=validateOnly};
 }
}
