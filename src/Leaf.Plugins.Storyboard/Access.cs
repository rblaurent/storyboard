using Leaf.Sdk;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;
public interface IGoogleIdentity {
 Task<(string Subject,string Email,string Name,string Avatar)> ValidateAsync(string token,string nonce,string audience,CancellationToken ct);
 Task<(string Subject,string Email,string Name,string Avatar)> ExchangeAsync(string code,string redirect,string nonce,string verifier,string client,string secret,CancellationToken ct);
}
public sealed class GoogleIdentity(HttpClient http):IGoogleIdentity {
 public async Task<(string Subject,string Email,string Name,string Avatar)> ExchangeAsync(string code,string redirect,string nonce,string verifier,string client,string secret,CancellationToken ct) {
  using var response=await http.PostAsync("https://oauth2.googleapis.com/token",new FormUrlEncodedContent(new Dictionary<string,string>{["code"]=code,["client_id"]=client,["client_secret"]=secret,["redirect_uri"]=redirect,["code_verifier"]=verifier,["grant_type"]="authorization_code"}),ct);
  if(!response.IsSuccessStatusCode)throw new StoryException("google_sign_in_failed",401);
  var token=JsonNode.Parse(await response.Content.ReadAsStringAsync(ct))!.AsObject().Text("id_token");return await ValidateAsync(token,nonce,client,ct);
 }
 public async Task<(string Subject,string Email,string Name,string Avatar)> ValidateAsync(string token,string nonce,string audience,CancellationToken ct) {
  if(string.IsNullOrWhiteSpace(audience)||string.IsNullOrWhiteSpace(nonce)||string.IsNullOrWhiteSpace(token)||token.Length>16384)throw new StoryException("google_sign_in_failed",401);
  GoogleJsonWebSignature.Payload payload;
  try{payload=await GoogleJsonWebSignature.ValidateAsync(token,new GoogleJsonWebSignature.ValidationSettings{Audience=[audience]}).WaitAsync(ct);}catch(Exception e)when(e is InvalidJwtException or ArgumentException or FormatException){throw new StoryException("google_sign_in_failed",401);}
  var encoded=token.Split('.')[1].Replace('-','+').Replace('_','/');encoded=encoded.PadRight((encoded.Length+3)/4*4,'=');using var raw=JsonDocument.Parse(Convert.FromBase64String(encoded));
  if(!payload.EmailVerified||string.IsNullOrWhiteSpace(payload.Subject)||payload.Subject.Length>255||!raw.RootElement.TryGetProperty("nonce",out var n)||n.ValueKind!=JsonValueKind.String||!StoryJson.Equal(n.GetString()??"",nonce))throw new StoryException("google_sign_in_failed",401);
  return(payload.Subject,payload.Email,payload.Name??payload.Email,payload.Picture??"");
 }
}
public sealed class StoryAccess(StoryStore store,IGoogleIdentity google,TimeProvider clock) {
 public const string Cookie="__Host-storyboard";public const string LoginCookie="__Host-storyboard-login";
 public static string AccountSlug(string subject)=>"g-"+StoryJson.Hash("https://accounts.google.com|"+subject);
 public static string Csrf(string token)=>StoryJson.Hash("storyboard-csrf|"+token);
 public async Task CheckProxyAsync(HttpContext h,CancellationToken ct) {
  var c=await store.ConfigAsync(ct)??throw new StoryException("storyboard_not_configured",503);var timestamp=h.Request.Headers["X-Storyboard-Time"].ToString();var signature=h.Request.Headers["X-Storyboard-Proof"].ToString();var origin=h.Request.Headers["X-Storyboard-Origin"].ToString();
  var now=clock.GetUtcNow().ToUnixTimeSeconds();
  if(string.IsNullOrWhiteSpace(c.Data.Text("proxy_secret"))||string.IsNullOrWhiteSpace(c.Data.Text("public_url"))||!long.TryParse(timestamp,out var seconds)||seconds<now-30||seconds>now+30||signature.Length!=64||!signature.All(char.IsAsciiHexDigit)||origin!=c.Data.Text("public_url"))throw new StoryException("site_connection_rejected",403);
  var expected=HMACSHA256.HashData(Encoding.UTF8.GetBytes(c.Data.Text("proxy_secret")),Encoding.UTF8.GetBytes(h.Request.Method+"\n"+h.Request.Path+h.Request.QueryString+"\n"+timestamp+"\n"+origin));
  if(!CryptographicOperations.FixedTimeEquals(expected,Convert.FromHexString(signature)))throw new StoryException("site_connection_rejected",403);
 }
 public async Task<LeafEntity> AccountAsync(string subject,string email,string name,string avatar,CancellationToken ct=default,string? enrollmentCampaign=null) {
  await store.Commands.WaitAsync(ct);try{return await AccountCoreAsync(subject,email,name,avatar,ct,enrollmentCampaign);}finally{store.Commands.Release();}
 }
 internal async Task<LeafEntity> AccountCoreAsync(string subject,string email,string name,string avatar,CancellationToken ct=default,string? enrollmentCampaign=null) {
  await store.WritableAsync(ct);
  if(string.IsNullOrWhiteSpace(subject)||subject.Length>255)throw new StoryException("invalid_google_identity",401);
  var data=await store.ProtectAsync(new JsonObject{["google_issuer"]="https://accounts.google.com",["google_subject"]=subject,["email"]=email,["email_key"]=StoryJson.Hash(email.ToLowerInvariant()),["avatar"]=avatar,["enabled"]=true,["can_create"]=false,["enrollment_campaign"]=enrollmentCampaign},ct);
  return await store.ChangeAsync("storyboard-account",AccountSlug(subject),StoryJson.Bounded(name,160,true),old=>{if(old is not null&&(old.Data.Text("google_subject")!=subject||old.Data.Text("google_issuer")!="https://accounts.google.com"))throw new StoryException("identity_reconciliation_required",409);if(old is not null&&!old.Data.Flag("enabled"))throw new StoryException("account_disabled",403);var next=old?.Data.DeepClone().AsObject()??data.DeepClone().AsObject();next["email"]=email;next["email_key"]=StoryJson.Hash(email.ToLowerInvariant());next["avatar"]=avatar;return next;},ct);
 }
 public async Task<string> BeginAsync(HttpContext h,CancellationToken ct) {
  await store.Commands.WaitAsync(ct);try{
  await store.WritableAsync(ct);
  var c=await store.ConfigAsync(ct)??throw new StoryException("storyboard_not_configured",503);if(c.Data.Text("google_client_id")==""||c.Data.Text("google_client_secret")=="")throw new StoryException("google_sign_in_not_configured",503);
  var state=StoryJson.Token();var nonce=StoryJson.Token();var verifier=StoryJson.Token();
  var data=await store.ProtectAsync(new JsonObject{["kind"]="login",["nonce"]=nonce,["verifier"]=verifier,["expires"]=clock.GetUtcNow().AddMinutes(10).ToUnixTimeSeconds(),["used"]=false},ct);
  await store.ChangeAsync("storyboard-session","o-"+StoryJson.Hash(state),"Google sign-in transaction",_=>data.DeepClone().AsObject(),ct);
  h.Response.Cookies.Append(LoginCookie,state,new CookieOptions{Secure=true,HttpOnly=true,SameSite=SameSiteMode.Lax,Path="/",MaxAge=TimeSpan.FromMinutes(10)});
  var challenge=Convert.ToBase64String(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+','-').Replace('/','_');
  var query=new Dictionary<string,string>{["client_id"]=c.Data.Text("google_client_id"),["redirect_uri"]=c.Data.Text("public_url")+"/auth/callback",["response_type"]="code",["scope"]="openid email profile",["state"]=state,["nonce"]=nonce,["code_challenge"]=challenge,["code_challenge_method"]="S256"};
  return "https://accounts.google.com/o/oauth2/v2/auth?"+string.Join("&",query.Select(p=>Uri.EscapeDataString(p.Key)+"="+Uri.EscapeDataString(p.Value)));
 }finally{store.Commands.Release();}
 }
 public async Task FinishAsync(HttpContext h,string code,string state,CancellationToken ct) {
  if(state.Length!=43||code.Length is <1 or >4000||!StoryJson.Equal(h.Request.Cookies[LoginCookie]??"",state))throw new StoryException("sign_in_expired",401);
  var slug="o-"+StoryJson.Hash(state);var login=await store.Entities.GetBySlugAsync("storyboard-session",slug,ct);if(login is null||login.Data.Text("kind")!="login"||login.Data.Flag("used")||login.Data.Number("expires")<=clock.GetUtcNow().ToUnixTimeSeconds())throw new StoryException("sign_in_expired",401);await store.CheckProtectionAsync(login,ct);
  await store.Commands.WaitAsync(ct);try{await store.WritableAsync(ct);var next=login.Data.DeepClone().AsObject();next["used"]=true;if(await store.Entities.CompareExchangeBySlugAsync(login.TypeSlug,slug,login.Name,next,login.UpdatedAt,ct) is null)throw new StoryException("sign_in_expired",401);}finally{store.Commands.Release();}
  var c=(await store.ConfigAsync(ct))!;var g=await google.ExchangeAsync(code,c.Data.Text("public_url")+"/auth/callback",login.Data.Text("nonce"),login.Data.Text("verifier"),c.Data.Text("google_client_id"),c.Data.Text("google_client_secret"),ct);
  await store.Commands.WaitAsync(ct);try{
  await store.WritableAsync(ct);var a=await AccountCoreAsync(g.Subject,g.Email,g.Name,g.Avatar,ct);if(!a.Data.Flag("enabled"))throw new StoryException("account_disabled",403);var token=await IssueSessionCoreAsync(a.Id.ToString(),ct);
  h.Response.Cookies.Append(Cookie,token,new CookieOptions{Secure=true,HttpOnly=true,SameSite=SameSiteMode.Lax,Path="/",MaxAge=TimeSpan.FromDays(30)});h.Response.Cookies.Delete(LoginCookie,new CookieOptions{Secure=true,HttpOnly=true,Path="/",SameSite=SameSiteMode.Lax});await store.AuditAsync("account.signed_in",a.Id.ToString(),a.Id.ToString(),ct:ct);
  }finally{store.Commands.Release();}
 }
 public async Task<string> IssueSessionAsync(string account,CancellationToken ct=default) {
  await store.Commands.WaitAsync(ct);try{return await IssueSessionCoreAsync(account,ct);}finally{store.Commands.Release();}
 }
 private async Task<string> IssueSessionCoreAsync(string account,CancellationToken ct) {
  await store.WritableAsync(ct);var actor=await store.RequireAsync("storyboard-account",account,ct);if(!actor.Data.Flag("enabled"))throw new StoryException("account_disabled",403);var token=StoryJson.Token();var data=await store.ProtectAsync(new JsonObject{["kind"]="browser",["account"]=account,["expires"]=clock.GetUtcNow().AddDays(30).ToUnixTimeSeconds(),["revoked"]=false},ct);
  await store.ChangeAsync("storyboard-session","s-"+StoryJson.Hash(token),"Storyboard browser session",_=>data.DeepClone().AsObject(),ct);return token;
 }
 public async Task<LeafEntity> AuthenticateAsync(string? token,CancellationToken ct=default) {
  if(token is null||token.Length!=43)throw new StoryException("sign_in_required",401);var s=await store.Entities.GetBySlugAsync("storyboard-session","s-"+StoryJson.Hash(token),ct);
  if(s is null||s.Data.Flag("revoked")||s.Data.Text("kind")!="browser"||s.Data.Number("expires")<=clock.GetUtcNow().ToUnixTimeSeconds())throw new StoryException("sign_in_required",401);
  await store.CheckProtectionAsync(s,ct);var a=await store.RequireAsync("storyboard-account",s.Data.Text("account"),ct);if(!a.Data.Flag("enabled"))throw new StoryException("account_disabled",403);return a;
 }
 public async Task MutationAsync(HttpContext h,CancellationToken ct) {
  var c=(await store.ConfigAsync(ct))!;var token=h.Request.Cookies[Cookie]??"";
  if(h.Request.Headers.Origin.ToString()!=c.Data.Text("public_url")||!StoryJson.Equal(h.Request.Headers["X-CSRF-Token"].ToString(),Csrf(token))||!h.Request.HasJsonContentType())throw new StoryException("request_origin_rejected",403);
 }
 public async Task LogoutAsync(HttpContext h,CancellationToken ct) {
  var token=h.Request.Cookies[Cookie]??"";var e=await store.Entities.GetBySlugAsync("storyboard-session","s-"+StoryJson.Hash(token),ct);
  if(e is not null)await store.ChangeAsync(e.TypeSlug,e.Slug,e.Name,old=>{var next=old!.Data.DeepClone().AsObject();next["revoked"]=true;return next;},ct);
  h.Response.Cookies.Delete(Cookie,new CookieOptions{Secure=true,HttpOnly=true,Path="/",SameSite=SameSiteMode.Lax});
 }
}
