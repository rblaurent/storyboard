using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;
public sealed class StoryException(string code,int status=400):Exception(code){public string Code{get;}=code;public int Status{get;}=status;}
public static class StoryJson {
 public static readonly JsonSerializerOptions Options=new(JsonSerializerDefaults.Web);
 public static string Text(this JsonObject o,string key,string fallback="")=>o[key] is null?fallback:o[key] is JsonValue v&&v.TryGetValue<string>(out var s)?s:throw new StoryException("invalid_json");
 public static bool Flag(this JsonObject o,string key)=>o[key] is null?false:o[key] is JsonValue v&&v.TryGetValue<bool>(out var b)?b:throw new StoryException("invalid_json");
 public static long Number(this JsonObject o,string key)=>o[key] is null?0:o[key] is JsonValue v?(v.TryGetValue<long>(out var n)?n:v.TryGetValue<int>(out var i)?i:throw new StoryException("invalid_json")):throw new StoryException("invalid_json");
 public static string Hash(string value)=>Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
 public static string Token()=>Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_');
 public static bool Equal(string a,string b)=>CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a),Encoding.UTF8.GetBytes(b));
 public static Guid Id(string value)=>Guid.TryParseExact(value,"D",out var id)&&id!=Guid.Empty?id:throw new StoryException("invalid_id");
 public static string Bounded(string? value,int max,bool required=false)=>value is null||value.Length>max||required&&string.IsNullOrWhiteSpace(value)?throw new StoryException("invalid_text"):value.Trim();
 public static JsonObject Object(object value)=>JsonSerializer.SerializeToNode(value,Options)!.AsObject();
 public static string Origin(string value)=>Uri.TryCreate(value,UriKind.Absolute,out var u)&&u.Scheme=="https"&&u.AbsolutePath=="/"&&u.UserInfo==""&&u.Query==""&&u.Fragment==""?u.GetLeftPart(UriPartial.Authority):throw new StoryException("https_origin_required");
}
public sealed record CampaignWrite(string Name,string Description,string Summary,long ExpectedRevision);
public sealed record CreateCampaign(string Name,string OperationId);
public sealed record MembershipWrite(string AccountId,string Role);
public sealed record GenerationWrite(string Kind,string Prompt,long ExpectedRevision,string OperationId);
