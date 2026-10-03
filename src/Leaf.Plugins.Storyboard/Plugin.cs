using Leaf.Sdk;
using Leaf.Sdk.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection;
using System.Text.Json.Nodes;
namespace Leaf.Plugins.Storyboard;
public sealed class StoryboardPlugin:ILeafPlugin,ILeafPublicApi {
 private string siteRoot="";
 public PluginManifest Manifest{get;}=Load();
 private static PluginManifest Load(){using var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("plugin.json")!;using var reader=new StreamReader(stream);return PluginManifest.Parse(reader.ReadToEnd());}
 public IReadOnlyList<PluginPublicEndpoint> PublicEndpoints=>[
  new("GET","/site/{**path}","Standalone website"),new("GET","/discover","Domain API"),new("GET","/auth/google","Google sign-in"),new("GET","/auth/callback","Google callback"),new("GET","/me","Authenticated account"),new("POST","/logout","Revoke session"),
  new("GET","/campaigns","Member campaigns"),new("POST","/campaigns","Create campaign"),new("GET","/campaigns/{id}","Authorized campaign"),new("PUT","/campaigns/{id}","Revision-checked update"),
  new("POST","/campaigns/{id}/archive","Archive"),new("POST","/campaigns/{id}/restore","Restore"),new("GET","/campaigns/{id}/players","Roster"),new("POST","/campaigns/{id}/players","Add/update member"),new("POST","/campaigns/{id}/players/{member}/remove","Remove membership"),
  new("GET","/campaigns/{id}/accounts","Exact GM account lookup"),new("POST","/campaigns/{id}/generate","Generate artwork or summary"),new("GET","/campaigns/{id}/operations/{operation}","Authorized operation"),new("GET","/campaigns/{id}/media/cover","Private cover"),new("GET","/campaigns/{id}/media/characters/{character}","Private portrait")];
 public void ConfigureServices(IServiceCollection s,PluginContext ctx) {
  siteRoot=StorySite.ResolveRoot(ctx.PluginDirectory);
  s.AddSingleton(TimeProvider.System);s.AddSingleton(sp=>new StoryStore(sp.GetRequiredKeyedService<IEntityStore>(Manifest.Id),sp.GetRequiredKeyedService<IRecordStreams>(Manifest.Id)));
  s.AddSingleton<StoryCampaigns>();s.AddSingleton<StoryPortals>();s.AddSingleton<StoryAdministration>();s.AddSingleton<StorySettings>();s.AddSingleton<IPluginSettingsProvider>(sp=>sp.GetRequiredService<StorySettings>());
  s.AddSingleton<IGoogleIdentity>(_=>new GoogleIdentity(new HttpClient(new SocketsHttpHandler{AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(30)}));s.AddSingleton<StoryAccess>();s.AddSingleton<StoryGeneration>();s.AddHostedService(sp=>sp.GetRequiredService<StoryGeneration>());
 }
 private static async ValueTask<object?> Errors(EndpointFilterInvocationContext c,EndpointFilterDelegate next){try{return await next(c);}catch(StoryException e){return Results.Json(new{error=e.Code},statusCode:e.Status);}catch(System.Text.Json.JsonException){return Results.BadRequest(new{error="invalid_json"});}catch(BadHttpRequestException e){return Results.Json(new{error="invalid_json"},statusCode:e.StatusCode);}}
 public Task OnStartupAsync(IPluginHost host,CancellationToken ct)=>Task.CompletedTask;
 public void MapEndpoints(RouteGroupBuilder group) {
  group.AddEndpointFilter(Errors);
  var portals=group.MapGroup("/portals/{key}");portals.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;var service=h.RequestServices.GetRequiredService<StoryPortals>();h.Items["storyboard-portal"]=await service.AuthorizeAsync((string)h.Request.RouteValues["key"]!,h,h.RequestServices.GetRequiredService<IAuthContext>(),h.RequestAborted);h.Response.Headers.CacheControl="private, no-store";return await next(c);});
  portals.MapPost("/identity",async(JsonObject? input,HttpContext h,StoryPortals p,CancellationToken ct)=>Results.Ok(await p.IdentityAsync((LeafEntity)h.Items["storyboard-portal"]!,input,ct)));
  portals.MapGet("/characters",async(HttpContext h,StoryPortals p,CancellationToken ct)=>Results.Ok(await p.ListAsync((LeafEntity)h.Items["storyboard-portal"]!,h.Request.Headers["X-Storyboard-Owner"].ToString(),ct)));
  portals.MapGet("/characters/{id}",async(string id,HttpContext h,StoryPortals p,CancellationToken ct)=>Results.Ok(await p.GetAsync((LeafEntity)h.Items["storyboard-portal"]!,h.Request.Headers["X-Storyboard-Owner"].ToString(),id,ct)));
  portals.MapPost("/characters",async(JsonObject? input,HttpContext h,StoryPortals p,CancellationToken ct)=>Results.Ok(await p.WriteAsync((LeafEntity)h.Items["storyboard-portal"]!,h.Request.Headers["X-Storyboard-Owner"].ToString(),null,input,ct)));
  portals.MapPatch("/characters/{id}",async(string id,JsonObject? input,HttpContext h,StoryPortals p,CancellationToken ct)=>Results.Ok(await p.WriteAsync((LeafEntity)h.Items["storyboard-portal"]!,h.Request.Headers["X-Storyboard-Owner"].ToString(),id,input,ct)));
  group.MapGet("/provision/agents",async(IAuthContext a,StoryStore store,CancellationToken ct)=>{if(!a.IsInRole("admin")||string.IsNullOrWhiteSpace(a.UserId))throw new StoryException("leaf_administrator_required",403);return Results.Ok((await store.ProvisionAgentsAsync(a.UserId,ct)).Select(e=>new{id=e.Id,name=e.Name}));});
  group.MapPost("/provision",async(JsonObject? input,HttpContext h,IAuthContext a,StoryStore store,StorySettings settings,CancellationToken ct)=>{
   if(await store.ConfigAsync(ct) is not null)await settings.RequireOwnerAsync(a.UserId,ct);
   if(!a.IsInRole("admin"))throw new StoryException("leaf_administrator_required",403);if(input is not null&&input.Any(p=>p.Key!="ownerAgentId"))throw new StoryException("invalid_json");
   var agent=input?.Text("ownerAgentId");
   if(string.IsNullOrEmpty(agent)&&h.User.Identity?.IsAuthenticated==true&&h.User.FindFirst("token_use")?.Value=="execution"){
    var identity=System.Text.Json.Nodes.JsonNode.Parse(h.User.FindFirst("execution_identity")?.Value??"null") as JsonObject;
    if(identity?["actor"] is JsonObject actor&&identity["beneficiary"] is JsonObject beneficiary&&actor.Text("kind")=="agent"&&beneficiary.Text("kind")=="user"&&beneficiary.Text("id")==a.UserId)agent=actor.Text("entityId",actor.Text("id"));
   }
   await store.ProvisionAsync(a.UserId!,ct,string.IsNullOrEmpty(agent)?null:agent);return Results.Ok(new{ok=true});
  });
  var manage=group.MapGroup("/manage");manage.AddEndpointFilter(async(c,next)=>{await c.HttpContext.RequestServices.GetRequiredService<StorySettings>().RequireOwnerAsync(c.HttpContext.RequestServices.GetRequiredService<IAuthContext>().UserId,c.HttpContext.RequestAborted);return await next(c);});
  manage.MapGet("/entities/{type}/{slug}",async(string type,string slug,StoryAdministration a,CancellationToken ct)=>Results.Ok(await a.ReadAsync(type,slug,ct)));
  manage.MapPut("/entities/{type}/{slug}",async(string type,string slug,JsonObject? input,StoryAdministration service,IAuthContext auth,CancellationToken ct)=>Results.Ok(await service.PutAsync(type,slug,input,auth.UserId!,ct)));
  manage.MapPut("/fence",async(JsonObject? input,StoryAdministration service,IAuthContext auth,CancellationToken ct)=>{if(input is null||input.Count!=1||input["writesFenced"] is null)throw new StoryException("invalid_json");return Results.Ok(await service.FenceAsync(input.Flag("writesFenced"),auth.UserId!,ct));});
  manage.MapGet("/status",async(StoryStore s,CancellationToken ct)=>{var c=(await s.ConfigAsync(ct))!;return Results.Ok(new{publicUrl=c.Data.Text("public_url"),googleConfigured=c.Data.Text("google_client_id")!=""&&c.Data.Text("google_client_secret")!="",workspace=c.Data.Text("workspace"),writesFenced=c.Data.Flag("writes_fenced"),installation=c.Data.Text("installation"),ownerAgentId=c.Data.Text("owner_agent_id"),version="0.1.0"});});
  manage.MapGet("/accounts",async(StoryStore s,CancellationToken ct)=>Results.Ok((await s.AllAsync("storyboard-account",ct:ct)).Select(e=>new{id=e.Id,name=e.Name,email=e.Data.Text("email"),avatar=e.Data.Text("avatar"),enabled=e.Data.Flag("enabled"),canCreate=e.Data.Flag("can_create")})));
  manage.MapPut("/accounts/{id}/eligibility",async(string id,JsonObject? value,StoryAdministration service,IAuthContext a,CancellationToken ct)=>Results.Ok(await service.EligibilityAsync(id,value,a.UserId!,ct)));
  manage.MapGet("/campaigns",async(StoryStore s,CancellationToken ct)=>Results.Ok((await s.AllAsync("storyboard-campaign",ct:ct)).Select(e=>new{id=e.Id,name=e.Name,state=e.Data.Text("state"),archived=e.Data.Flag("archived"),workspace=e.Data.Text("workspace")})));
  manage.MapGet("/audit",async(StoryStore s,CancellationToken ct)=>Results.Ok(await s.AuditListAsync(ct)));
  manage.MapGet("/operations",async(StoryStore s,CancellationToken ct)=>Results.Ok((await s.AllAsync("storyboard-generation",ct:ct)).Select(StoryGeneration.Projection)));
 }
 public void MapPublicEndpoints(RouteGroupBuilder group) {
  group.AddEndpointFilter(Errors);group.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;h.Response.Headers.CacheControl="private, no-store";await h.RequestServices.GetRequiredService<StoryAccess>().CheckProxyAsync(h,h.RequestAborted);return await next(c);});
  group.MapGet("/site/{**path}",(string? path)=>Site(path));group.MapGet("/discover",()=>Results.Ok(new{service="Storyboard",version="0.1.0",routes=PublicEndpoints}));
  group.MapGet("/auth/google",async(HttpContext h,StoryAccess a,CancellationToken ct)=>Results.Redirect(await a.BeginAsync(h,ct)));
  group.MapGet("/auth/callback",async(HttpContext h,StoryAccess a,CancellationToken ct)=>{await a.FinishAsync(h,h.Request.Query["code"].ToString(),h.Request.Query["state"].ToString(),ct);return Results.Redirect("/");});
  group.MapGet("/me",async(HttpContext h,StoryAccess a,CancellationToken ct)=>{var e=await a.AuthenticateAsync(h.Request.Cookies[StoryAccess.Cookie],ct);return Results.Ok(new{id=e.Id,name=e.Name,avatar=e.Data.Text("avatar"),canCreate=e.Data.Flag("can_create"),csrfToken=StoryAccess.Csrf(h.Request.Cookies[StoryAccess.Cookie]!)});});
  group.MapPost("/logout",async(HttpContext h,StoryAccess a,CancellationToken ct)=>{await a.AuthenticateAsync(h.Request.Cookies[StoryAccess.Cookie],ct);await a.MutationAsync(h,ct);await a.LogoutAsync(h,ct);return Results.Ok(new{ok=true});});
  var api=group.MapGroup("/campaigns");api.AddEndpointFilter(async(c,next)=>{var h=c.HttpContext;var a=h.RequestServices.GetRequiredService<StoryAccess>();var e=await a.AuthenticateAsync(h.Request.Cookies[StoryAccess.Cookie],h.RequestAborted);h.Items["storyboard-account"]=e.Id.ToString();if(h.Request.Method!="GET")await a.MutationAsync(h,h.RequestAborted);return await next(c);});
  api.MapGet("",async(HttpContext h,StoryCampaigns c,CancellationToken ct)=>Results.Ok(await c.ListAsync(Actor(h),h.Request.Query["archived"]=="true",ct)));
  api.MapPost("",async(CreateCampaign input,HttpContext h,StoryCampaigns c,CancellationToken ct)=>{var e=await c.CreateAsync(Actor(h),input,ct);return Results.Ok(await c.ProjectionAsync(e,Actor(h),ct));});
  api.MapGet("/{id}",async(string id,HttpContext h,StoryCampaigns c,StoryStore s,CancellationToken ct)=>Results.Ok(await c.ProjectionAsync(await s.RequireAsync("storyboard-campaign",id,ct),Actor(h),ct)));
  api.MapPut("/{id}",async(string id,CampaignWrite input,HttpContext h,StoryCampaigns c,CancellationToken ct)=>Results.Ok(await c.ProjectionAsync(await c.SaveAsync(id,Actor(h),input,ct),Actor(h),ct)));
  api.MapPost("/{id}/archive",async(string id,HttpContext h,StoryCampaigns c,CancellationToken ct)=>Results.Ok(await c.ProjectionAsync(await c.ArchiveAsync(id,Actor(h),true,ct),Actor(h),ct)));
  api.MapPost("/{id}/restore",async(string id,HttpContext h,StoryCampaigns c,CancellationToken ct)=>Results.Ok(await c.ProjectionAsync(await c.ArchiveAsync(id,Actor(h),false,ct),Actor(h),ct)));
  api.MapGet("/{id}/players",async(string id,HttpContext h,StoryCampaigns c,CancellationToken ct)=>Results.Ok(await c.PlayersAsync(id,Actor(h),ct)));
  api.MapPost("/{id}/players",async(string id,MembershipWrite input,HttpContext h,StoryCampaigns c,CancellationToken ct)=>{await c.SetMemberAsync(id,Actor(h),input,ct);return Results.Ok(await c.PlayersAsync(id,Actor(h),ct));});
  api.MapPost("/{id}/players/{member}/remove",async(string id,string member,HttpContext h,StoryCampaigns c,CancellationToken ct)=>{await c.RemoveMemberAsync(id,Actor(h),member,ct);return Results.Ok(new{ok=true});});
  api.MapGet("/{id}/accounts",async(string id,HttpContext h,StoryCampaigns c,StoryStore s,CancellationToken ct)=>{await c.MembershipAsync(id,Actor(h),true,ct);var email=StoryJson.Bounded(h.Request.Query["email"].ToString(),254,true).ToLowerInvariant();return Results.Ok((await s.AllAsync("storyboard-account",new Dictionary<string,object?>{["email_key"]=StoryJson.Hash(email),["enabled"]=true},ct)).Select(e=>new{id=e.Id,name=e.Name,avatar=e.Data.Text("avatar")}));});
  api.MapPost("/{id}/generate",async(string id,GenerationWrite input,HttpContext h,StoryGeneration g,CancellationToken ct)=>Results.Ok(StoryGeneration.Projection(await g.StartAsync(id,Actor(h),input,ct))));
  api.MapGet("/{id}/operations/{operation}",async(string id,string operation,HttpContext h,StoryStore s,StoryCampaigns c,CancellationToken ct)=>{await c.MembershipAsync(id,Actor(h),true,ct);var op=await s.RequireAsync("storyboard-generation",operation,ct);if(op.Data.Text("campaign")!=id)throw new StoryException("not_found",404);return Results.Ok(StoryGeneration.Projection(op));});
  api.MapGet("/{id}/media/cover",async(string id,HttpContext h,StoryStore s,StoryCampaigns c,IAssets assets,CancellationToken ct)=>{await c.MembershipAsync(id,Actor(h),ct:ct);var e=await s.RequireAsync("storyboard-campaign",id,ct);return await Media(assets,e.Data.Text("cover_asset"),ct);});
  api.MapGet("/{id}/media/characters/{character}",async(string id,string character,HttpContext h,StoryStore s,StoryCampaigns c,IAssets assets,CancellationToken ct)=>{await c.MembershipAsync(id,Actor(h),ct:ct);var e=await s.RequireAsync("storyboard-character",character,ct);if(e.Data.Text("campaign")!=id)throw new StoryException("not_found",404);return await Media(assets,e.Data.Text("portrait"),ct);});
 }
 private static string Actor(HttpContext h)=>(string)h.Items["storyboard-account"]!;
 private static async Task<IResult> Media(IAssets a,string id,CancellationToken ct){if(string.IsNullOrWhiteSpace(id))return Results.NotFound();var file=await a.ReadAsync(id,ct);return file is null?Results.NotFound():Results.Bytes(file.Bytes,file.ContentType);}
 private IResult Site(string? path)=>StorySite.Serve(siteRoot,path);

}
