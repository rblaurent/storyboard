using Leaf.Plugins.Storyboard;
using Leaf.Sdk;
using Leaf.Sdk.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
namespace Storyboard.Testing;

// Disposable, synthetic SDK stores and Google/Compute adapters. Never registered
// by the production plugin and never used to claim authenticated acceptance.
public sealed class FakeGoogle:IGoogleIdentity {
 public string Subject="oidc:fixture-user";public int Exchanges;public int Validations;public Func<Task>? DuringExchange;
 public Task<(string Subject,string Email,string Name,string Avatar)> ValidateAsync(string token,string nonce,string audience,CancellationToken ct){Validations++;if(token!="fixture-token"||nonce!="fixture-nonce"||audience!="fixture-client")throw new StoryException("google_sign_in_failed",401);return Task.FromResult((Subject,"fixture@example.invalid","Fixture account",""));}
 public async Task<(string Subject,string Email,string Name,string Avatar)> ExchangeAsync(string code,string redirect,string nonce,string verifier,string client,string secret,CancellationToken ct){Interlocked.Increment(ref Exchanges);if(DuringExchange is not null)await DuringExchange();return (Subject,"fixture@example.invalid","Fixture account","");}
}
public sealed class FakeCompute:IAiInference,IComfyUiWorkflows,IComputeJobs,IAssets {
 public Dictionary<string,AiCompletion> TextJobs=[];public Dictionary<string,ComputeJob> ImageJobs=[];public List<AiRequest> Requests=[];public JsonObject? Inputs;public int Uploads;public string? Capability;public Func<Task>? DuringText;public Func<Task>? DuringImage;public int Submissions;
 public async Task<AiCompletion> OneshotAsync(AiRequest r,CancellationToken ct=default){Requests.Add(r);if(DuringText is not null)await DuringText();if(!TextJobs.TryGetValue(r.IdempotencyKey!,out var result))TextJobs[r.IdempotencyKey!]=result=new AiCompletion("Fixture generated result","fixture",Guid.NewGuid().ToString());return result;}
 public Task<IAiSession> CreateSessionAsync(AiSessionOptions o,CancellationToken ct=default)=>throw new NotSupportedException();
 public async Task<ComputeJob> SubmitAsync(string name,JsonObject inputs,ComputeJobOptions? options=null,CancellationToken ct=default){Submissions++;Inputs=inputs.DeepClone().AsObject();if(DuringImage is not null)await DuringImage();if(!ImageJobs.TryGetValue(options!.IdempotencyKey!,out var result))ImageJobs[options.IdempotencyKey!]=result=new ComputeJob("image-gen",Guid.NewGuid().ToString());return result;}
 public Task<ComputeJobProgress> PollAsync(string capability,string id,CancellationToken ct=default)=>Task.FromResult(new ComputeJobProgress("completed",1,null,null,null));
 public Task<ComputeJobProgress> WaitAsync(string capability,string id,Action<ComputeJobProgress>? onProgress=null,ComputeJobOptions? options=null,CancellationToken ct=default){Capability=capability;return PollAsync(capability,id,ct);}
 public Task<ComputeJobOutput?> DownloadOutputAsync(string capability,string id,string? artifact=null,CancellationToken ct=default)=>Task.FromResult<ComputeJobOutput?>(new(new MemoryStream([1,2,3]),"image/png"));
 public Task<ComputeStatus?> GetStatusAsync(CancellationToken ct=default)=>Task.FromResult<ComputeStatus?>(null);
 public Task<AssetRef> UploadAsync(Stream s,string filename,string? contentType=null,CancellationToken ct=default)=>throw new NotSupportedException();
 public Task<AssetRef> UploadIdempotentAsync(Stream s,string key,string filename,string? contentType=null,CancellationToken ct=default){Uploads++;return Task.FromResult(new AssetRef("fixture-cover.png","/api/assets/fixture-cover.png"));}
 public string GetUrl(string id)=>"/api/assets/"+id;
 public Task<AssetFile?> ReadAsync(string id,CancellationToken ct=default)=>Task.FromResult<AssetFile?>(new([1,2,3],"image/png"));
}
public sealed class TestAuth(IHttpContextAccessor accessor):IAuthContext {
 public string? UserId=>accessor.HttpContext?.Request.Headers["X-Test-Leaf-User"].FirstOrDefault();public string? Email=>null;public IReadOnlyList<string> Roles=>UserId is null?[]:["admin"];public bool IsInRole(string role)=>Roles.Contains(role);
}
public sealed class Fixture:IAsyncDisposable {
 public TestEntities Entities=new();public TestRecords Records=new();public TestClock Clock=new();public FakeGoogle Google=new();public FakeCompute Compute=new();public string Owner=Guid.NewGuid().ToString();public StoryStore Store=null!;public StoryAccess Access=null!;public StoryCampaigns Campaigns=null!;public StoryGeneration Generation=null!;public StoryPortals Portals=null!;public StoryAdministration Admin=null!;public LeafEntity Gm=null!,Player=null!,Outsider=null!,Campaign=null!;public WebApplication? App;
 public static async Task<Fixture> Create(){var f=new Fixture();f.Store=new(f.Entities,f.Records);await f.Entities.CreateAsync("agent","Fixture owning agent",new JsonObject());await f.Store.ProvisionAsync(f.Owner);await f.Config(new(){["public_url"]="https://fixture.invalid",["proxy_secret"]=StoryJson.Token(),["google_client_id"]="fixture-client",["google_client_secret"]="fixture-secret"});await f.Entities.UpsertBySlugAsync("comfyui-workflow","z_turbo","Fixture workflow",new(){["workflow_json"]=new JsonObject(),["parameters"]=new JsonArray()});f.Access=new(f.Store,f.Google,f.Clock);f.Campaigns=new(f.Store);f.Generation=f.NewGeneration();f.Portals=new(f.Store,f.Campaigns,f.Access,f.Google);f.Admin=new(f.Store);
 f.Gm=await f.Access.AccountAsync("fixture:gm","gm@example.invalid","Fixture GM","");f.Player=await f.Access.AccountAsync("fixture:player","player@example.invalid","Fixture player","");f.Outsider=await f.Access.AccountAsync("fixture:outsider","outsider@example.invalid","Fixture outsider","");await f.Entities.PatchAsync(f.Gm.Id,new(){["can_create"]=true});f.Campaign=await f.Campaigns.CreateAsync(f.Gm.Id.ToString(),new("Fixture campaign",Guid.NewGuid().ToString()));await f.Campaigns.SetMemberAsync(f.Campaign.Id.ToString(),f.Gm.Id.ToString(),new(f.Player.Id.ToString(),"player"));return f;}
 public StoryGeneration NewGeneration()=>new(Store,Campaigns,Compute,Compute,Compute,Compute,NullLogger<StoryGeneration>.Instance);
 public async Task Config(JsonObject patch){var c=(await Store.ConfigAsync())!;await Entities.PatchAsync(c.Id,patch);}
 public static JsonObject Schema()=>new(){["portrait_type"]="fixture-portrait",["character_key"]="gid",["character_fields"]=new JsonObject{["gid"]=new JsonObject{["type"]="string",["maxLength"]=64},["age"]=new JsonObject{["type"]="string",["maxLength"]=256},["name"]=new JsonObject{["type"]="string",["maxLength"]=256},["statement"]=new JsonObject{["type"]="string",["maxLength"]=4000},["portrait"]=new JsonObject{["type"]="portrait",["maxLength"]=256},["tier"]=new JsonObject{["type"]="integer",["min"]=0,["max"]=10},["onboarded"]=new JsonObject{["type"]="boolean"}}};
 public async Task<LeafEntity> Portal(string key="fixture",string? campaign=null){var d=await Store.ProtectAsync(new(){["key"]=key,["campaign"]=campaign??Campaign.Id.ToString(),["portal_secret"]=StoryJson.Token(),["google_client_id"]="fixture-client",["legacy_workspace"]="fixture-workspace"});foreach(var p in Schema())d[p.Key]=p.Value?.DeepClone();return await Store.ChangeAsync("storyboard-portal",key,"Fixture portal",_=>d);}
 public async Task<LeafEntity> Character(LeafEntity actor,string? legacy=null){var member=await Campaigns.MembershipAsync(Campaign.Id.ToString(),actor.Id.ToString());var d=await Store.ProtectAsync(new(){["account"]=actor.Id.ToString(),["campaign"]=Campaign.Id.ToString(),["player"]=member.Id.ToString(),["legacy_id"]=legacy,["portrait"]="fixture-old.png",["game_data"]=new JsonObject{["name"]="Fixture character",["tier"]=2,["age"]="32",["gid"]="FIX_001",["portrait"]=Guid.NewGuid().ToString(),["source_extra"]="preserved"}});return await Store.ChangeAsync("storyboard-character","fixture-char-"+actor.Id,"Fixture character",_=>d);}
 public async Task<HttpClient> Host(){var b=WebApplication.CreateBuilder();b.WebHost.UseTestServer();b.Services.AddHttpContextAccessor();b.Services.AddScoped<IAuthContext,TestAuth>();b.Services.AddSingleton(Store);b.Services.AddSingleton(Access);b.Services.AddSingleton(Campaigns);b.Services.AddSingleton(Portals);b.Services.AddSingleton(Admin);b.Services.AddSingleton(Generation);b.Services.AddSingleton(new StorySettings(Store));b.Services.AddSingleton<IAssets>(Compute);App=b.Build();var plugin=new StoryboardPlugin();plugin.MapEndpoints(App.MapGroup("/api/apps/storyboard"));plugin.MapPublicEndpoints(App.MapGroup("/api/public/storyboard"));await App.StartAsync();return App.GetTestClient();}
 public async Task<HttpRequestMessage> PublicRequest(string path,string method="GET",string? json=null,LeafEntity? actor=null){var r=new HttpRequestMessage(new HttpMethod(method),"/api/public/storyboard"+path);if(json is not null)r.Content=new StringContent(json,Encoding.UTF8,"application/json");var c=(await Store.ConfigAsync())!;var t=Clock.GetUtcNow().ToUnixTimeSeconds().ToString();r.Headers.Add("X-Storyboard-Time",t);r.Headers.Add("X-Storyboard-Origin","https://fixture.invalid");var proof=HMACSHA256.HashData(Encoding.UTF8.GetBytes(c.Data.Text("proxy_secret")),Encoding.UTF8.GetBytes(method+"\n"+r.RequestUri!.OriginalString+"\n"+t+"\nhttps://fixture.invalid"));r.Headers.Add("X-Storyboard-Proof",Convert.ToHexStringLower(proof));if(actor is not null){var token=await Access.IssueSessionAsync(actor.Id.ToString());r.Headers.Add("Cookie",StoryAccess.Cookie+"="+token);r.Headers.Add("X-CSRF-Token",StoryAccess.Csrf(token));r.Headers.Add("Origin","https://fixture.invalid");}return r;}
 public async ValueTask DisposeAsync(){if(App is not null)await App.DisposeAsync();Generation.Dispose();}
}
