using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Leaf.Plugins.Storyboard;

// Registration is private operator configuration, never browser supplied.
public sealed class PortalSchema {
 public JsonObject Fields { get; }
 public string StableKey { get; }
 public string? PortraitKey { get; }
 public string PortraitType { get; }
 public static bool Reserved(string key)=>Regex.IsMatch(key,"(?i)(secret|token|password|credential|nonce|verifier|authorization)")||key is "id" or "account" or "parent" or "campaign" or "player" or "installation" or "owner_id" or "owner_agent_id" or "owner_plugin" or "confidential" or "legacy_id" or "legacy_owner" or "migration_run" or "google_subject" or "google_issuer" or "google_client_id" or "role" or "role_ref" or "enabled" or "can_create" or "writes_fenced";
 public PortalSchema(JsonObject config){
  if(config["character_fields"] is not JsonObject fields||fields.Count is <1 or >64)throw new StoryException("invalid_portal_schema");
  Fields=fields;StableKey=config.Text("character_key");PortraitType=config.Text("portrait_type");
  foreach(var p in fields){
   if(!Regex.IsMatch(p.Key,"^[a-z][a-z0-9_]{0,63}$")||Reserved(p.Key)||p.Value is not JsonObject d||d.Any(v=>v.Key is not "type" and not "maxLength" and not "min" and not "max"))throw new StoryException("invalid_portal_schema");
   switch(d.Text("type")){
    case "string":case "portrait":if(d.Number("maxLength") is <1 or >4000)throw new StoryException("invalid_portal_schema");break;
    case "integer":if(d.Number("min")>d.Number("max")||d.Number("min")< -1_000_000_000||d.Number("max")>1_000_000_000)throw new StoryException("invalid_portal_schema");break;
    case "boolean":break;
    default:throw new StoryException("invalid_portal_schema");
   }
   if(d.Text("type")=="portrait"){if(PortraitKey is not null)throw new StoryException("invalid_portal_schema");PortraitKey=p.Key;}
  }
  if(StableKey!=""&&(fields[StableKey] is not JsonObject key||key.Text("type")!="string"))throw new StoryException("invalid_portal_schema");
  if(PortraitKey is not null&&!Regex.IsMatch(PortraitType,"^[a-z][a-z0-9-]{0,99}$"))throw new StoryException("invalid_portal_schema");
 }
 public JsonObject Patch(JsonObject input){
  if(input.ToJsonString().Length>12000)throw new StoryException("invalid_character_data");var result=new JsonObject();
  foreach(var p in input){
   if(Reserved(p.Key)||Fields[p.Key] is not JsonObject d)throw new StoryException("character_field_forbidden");
   if(p.Value is null)throw new StoryException("invalid_character_data");
   switch(d.Text("type")){
    case "string":case "portrait":result[p.Key]=StoryJson.Bounded(input.Text(p.Key),(int)d.Number("maxLength"));break;
    case "integer":var n=input.Number(p.Key);if(n<d.Number("min")||n>d.Number("max"))throw new StoryException("invalid_character_data");result[p.Key]=n;break;
    case "boolean":result[p.Key]=input.Flag(p.Key);break;
   }
  }return result;
 }
 public JsonObject Project(JsonObject game){var result=new JsonObject();foreach(var p in Fields)if(game.TryGetPropertyValue(p.Key,out var value))result[p.Key]=value?.DeepClone();return result;}
}
