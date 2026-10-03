using Leaf.Plugins.Storyboard;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using System.Text.Json.Nodes;
using Xunit;
namespace Storyboard.Testing;
public sealed class ReviewTests {
 [Fact] public async Task RegisteredManagementAcceptsOpaqueLegacyAliasWithoutReadingOriginalGameCharacter(){
  await using var f=await Fixture.Create();var portal=await f.Portal();var source=await f.Entities.CreateAsync("fixture-portrait","Shared artwork",new(){["parent"]="fixture-workspace",["image_url"]="/api/assets/"+Guid.NewGuid()+".png"});
  var member=await f.Campaigns.MembershipAsync(f.Campaign.Id.ToString(),f.Player.Id.ToString());var alias=Guid.NewGuid().ToString();var asset=source.Data.Text("image_url").Split('/').Last();await f.Admin.FenceAsync(true,f.Owner,default);
  var fields=new JsonObject{["account"]=f.Player.Id.ToString(),["player"]=member.Id.ToString(),["campaign"]=f.Campaign.Id.ToString(),["portrait"]=asset,["legacy_id"]=alias,["game_key"]="fixture",["game_data"]=new JsonObject{["age"]="32",["portrait"]=source.Id.ToString(),["private_source_extra"]="retained"}};
  var saved=StoryJson.Object(await f.Admin.PutAsync("storyboard-character","generic-legacy",new(){["name"]="Generic fixture",["data"]=fields.DeepClone(),["expectedUpdatedAt"]=null},f.Owner,default));
  Assert.Null(await f.Entities.GetAsync(Guid.Parse(alias)));Assert.Equal("retained",saved["data"]!["game_data"]!.AsObject().Text("private_source_extra"));
  var projected=StoryJson.Object(await f.Portals.GetAsync(portal,f.Player.Id.ToString(),alias));Assert.False(projected["data"]!.AsObject().ContainsKey("private_source_extra"));Assert.Equal(source.Id.ToString(),projected["data"]!.AsObject().Text("portrait"));
  fields["portrait"]="wrong.png";fields["legacy_id"]=Guid.NewGuid().ToString();await Assert.ThrowsAsync<StoryException>(()=>f.Admin.PutAsync("storyboard-character","other-alias",new(){["name"]="Generic fixture",["data"]=fields.DeepClone(),["expectedUpdatedAt"]=null},f.Owner,default));
 }
 [Fact] public async Task FenceAfterImageSubmissionRetainsExactJobAndPreviousCoverUntilResume(){
  await using var f=await Fixture.Create();await f.Entities.PatchAsync(f.Campaign.Id,new(){["cover_asset"]="previous.png"});var op=await f.Generation.StartAsync(f.Campaign.Id.ToString(),f.Gm.Id.ToString(),new("image","Fixture landscape",1,Guid.NewGuid().ToString()),default);
  f.Compute.DuringImage=()=>f.Admin.FenceAsync(true,f.Owner,default);Assert.Equal("writes_fenced",(await Assert.ThrowsAsync<StoryException>(()=>f.Generation.RunAsync(op,default))).Code);
  var paused=(await f.Entities.GetAsync(op.Id))!;Assert.NotEmpty(paused.Data.Text("image_job"));Assert.Equal("generating",paused.Data.Text("state"));Assert.Equal("previous.png",(await f.Entities.GetAsync(f.Campaign.Id))!.Data.Text("cover_asset"));Assert.Equal(0,f.Compute.Uploads);
  f.Compute.DuringImage=null;await f.Admin.FenceAsync(false,f.Owner,default);using var restart=f.NewGeneration();await restart.RunAsync(paused,default);Assert.Equal(1,f.Compute.Submissions);Assert.Equal(paused.Data.Text("image_job"),(await f.Entities.GetAsync(op.Id))!.Data.Text("image_job"));Assert.True((await f.Entities.GetAsync(op.Id))!.Data.Flag("applied"));
 }
 [Fact] public async Task FencePausesStagedPublicationAndPendingWorkWithoutTerminalFailure(){
  await using var f=await Fixture.Create();var pending=await f.Generation.StartAsync(f.Campaign.Id.ToString(),f.Gm.Id.ToString(),new("summary","",1,Guid.NewGuid().ToString()),default);
  var d=pending.Data.DeepClone().AsObject();d["state"]="staged";d["previous_operation"]=pending.Id.ToString();var staged=await f.Store.ChangeAsync(pending.TypeSlug,"fixture-fenced-stage","Fixture staged",_=>d);
  await f.Admin.FenceAsync(true,f.Owner,default);await Assert.ThrowsAsync<StoryException>(()=>f.Generation.RecoverAsync());await Assert.ThrowsAsync<StoryException>(()=>f.Generation.RunAsync(pending,default));Assert.Equal("staged",(await f.Entities.GetAsync(staged.Id))!.Data.Text("state"));Assert.Equal("pending",(await f.Entities.GetAsync(pending.Id))!.Data.Text("state"));Assert.Empty(f.Compute.Requests);
  await f.Admin.FenceAsync(false,f.Owner,default);await f.Generation.RecoverAsync();await f.Generation.RunAsync(staged,default);Assert.True((await f.Entities.GetAsync(staged.Id))!.Data.Flag("applied"));
 }
 private static async Task<string> Login(Fixture f,DefaultHttpContext h){var begin=new DefaultHttpContext();var uri=new Uri(await f.Access.BeginAsync(begin,default));var state=QueryHelpers.ParseQuery(uri.Query)["state"].ToString();h.Request.Headers.Cookie=StoryAccess.LoginCookie+"="+state;return state;}
 [Fact] public async Task FenceDuringExternalGoogleExchangePreventsAccountAndSessionCreationButLogoutWorks(){
  await using var f=await Fixture.Create();var token=await f.Access.IssueSessionAsync(f.Player.Id.ToString());var h=new DefaultHttpContext();var state=await Login(f,h);
  f.Google.DuringExchange=()=>f.Admin.FenceAsync(true,f.Owner,default);
  Assert.Equal("writes_fenced",(await Assert.ThrowsAsync<StoryException>(()=>f.Access.FinishAsync(h,"fixture-code",state,default))).Code);
  Assert.Null(await f.Entities.GetBySlugAsync("storyboard-account",StoryAccess.AccountSlug(f.Google.Subject)));
  Assert.Equal("writes_fenced",(await Assert.ThrowsAsync<StoryException>(()=>f.Access.BeginAsync(new DefaultHttpContext(),default))).Code);
  Assert.Equal("writes_fenced",(await Assert.ThrowsAsync<StoryException>(()=>f.Access.IssueSessionAsync(f.Player.Id.ToString()))).Code);
  h=new DefaultHttpContext();h.Request.Headers.Cookie=StoryAccess.Cookie+"="+token;await f.Access.LogoutAsync(h,default);
  Assert.Equal("sign_in_required",(await Assert.ThrowsAsync<StoryException>(()=>f.Access.AuthenticateAsync(token))).Code);
 }
 [Fact] public async Task DisabledAccountAfterGoogleExchangeCannotBeUpdatedOrIssuedSession(){
  await using var f=await Fixture.Create();f.Google.Subject="fixture:player";var h=new DefaultHttpContext();var state=await Login(f,h);
  f.Google.DuringExchange=()=>f.Entities.PatchAsync(f.Player.Id,new(){["enabled"]=false});
  Assert.Equal("account_disabled",(await Assert.ThrowsAsync<StoryException>(()=>f.Access.FinishAsync(h,"fixture-code",state,default))).Code);
  Assert.Equal("player@example.invalid",(await f.Entities.GetAsync(f.Player.Id))!.Data.Text("email"));Assert.Equal(0,h.Response.Headers.SetCookie.Count);
 }
 [Fact] public async Task ActualAccessCookieHeadersAreExportedForWorkerPropagationTest(){
  await using var f=await Fixture.Create();var h=new DefaultHttpContext();var state=await Login(f,h);await f.Access.FinishAsync(h,"fixture-code",state,default);
  var headers=h.Response.Headers.SetCookie.ToArray();Assert.Equal(2,headers.Length);
  var logout=new DefaultHttpContext();logout.Request.Headers.Cookie=headers[0]!.Split(';')[0];await f.Access.LogoutAsync(logout,default);
  var all=headers.Concat(logout.Response.Headers.SetCookie.ToArray()).ToArray();Assert.Equal(3,all.Length);Assert.All(all,c=>{Assert.Contains("samesite=lax",c!);Assert.Contains("secure",c!);Assert.Contains("httponly",c!);Assert.Contains("path=/",c!);});
  var path=Path.Combine(Environment.GetEnvironmentVariable("REDLEAF_SCRATCH_DIR")!,"storyboard-backend","access-cookie-headers.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);await File.WriteAllTextAsync(path,System.Text.Json.JsonSerializer.Serialize(all));
 }
 [Fact] public async Task FencePausesBackgroundGenerationAndResumesItsExactResult(){
  await using var f=await Fixture.Create();var op=await f.Generation.StartAsync(f.Campaign.Id.ToString(),f.Gm.Id.ToString(),new("summary","",1,Guid.NewGuid().ToString()),default);
  f.Compute.DuringText=()=>f.Admin.FenceAsync(true,f.Owner,default);await f.Generation.StartAsync(default(CancellationToken));
  var paused=op;for(var n=0;n<100;n++){paused=(await f.Entities.GetAsync(op.Id))!;if(paused.Data.Number("paused_at")>0)break;await Task.Delay(10);}await f.Generation.StopAsync(default);
  Assert.Equal("saving",paused.Data.Text("state"));Assert.NotEmpty(paused.Data.Text("text_job"));Assert.NotEmpty(paused.Data.Text("result"));Assert.Empty((await f.Entities.GetAsync(f.Campaign.Id))!.Data.Text("summary"));
  await f.Admin.FenceAsync(false,f.Owner,default);using var restarted=f.NewGeneration();await restarted.RunAsync(paused,default);
  var complete=(await f.Entities.GetAsync(op.Id))!;Assert.Equal("completed",complete.Data.Text("state"));Assert.True(complete.Data.Flag("applied"));Assert.Single(f.Compute.Requests);Assert.Equal(paused.Data.Text("text_job"),complete.Data.Text("text_job"));
 }
 [Fact] public async Task RecoveryCancelsLostActorAndContinuesLaterStagedOperation(){
  await using var f=await Fixture.Create();await f.Campaigns.SetMemberAsync(f.Campaign.Id.ToString(),f.Gm.Id.ToString(),new(f.Player.Id.ToString(),"gm"));
  f.Entities.BeforeCas=(type,slug,data)=>{if(type=="storyboard-campaign"&&data.Text("latest_summary")!="")throw new IOException("fixture publication interruption");};
  await Assert.ThrowsAsync<IOException>(()=>f.Generation.StartAsync(f.Campaign.Id.ToString(),f.Player.Id.ToString(),new("summary","",1,Guid.NewGuid().ToString()),default));f.Entities.BeforeCas=null;
  var first=Assert.Single(await f.Generation.ActiveAsync());await f.Campaigns.RemoveMemberAsync(f.Campaign.Id.ToString(),f.Gm.Id.ToString(),(await f.Campaigns.MembershipAsync(f.Campaign.Id.ToString(),f.Player.Id.ToString())).Id.ToString());
  var secondData=first.Data.DeepClone().AsObject();secondData["account"]=f.Gm.Id.ToString();var second=await f.Store.ChangeAsync(first.TypeSlug,"fixture-second-staged","Fixture later operation",_=>secondData);
  await f.Generation.RecoverAsync();Assert.Equal("failed",(await f.Entities.GetAsync(first.Id))!.Data.Text("state"));Assert.Equal("pending",(await f.Entities.GetAsync(second.Id))!.Data.Text("state"));await f.Generation.RunAsync(second,default);Assert.True((await f.Entities.GetAsync(second.Id))!.Data.Flag("applied"));
 }
 [Fact] public async Task PortalUsesRegisteredSchemaAndGenericOperationRetryWithoutGameAssumptions(){
  await using var f=await Fixture.Create();var p=await f.Portal();await f.Entities.PatchAsync(p.Id,new(){["character_key"]="",["portrait_type"]="another-product-art",["character_fields"]=new JsonObject{["title"]=new JsonObject{["type"]="string",["maxLength"]=24},["level"]=new JsonObject{["type"]="integer",["min"]=1,["max"]=5}}});p=(await f.Entities.GetAsync(p.Id))!;
  var input=new JsonObject{["name"]="Generic character",["operationId"]=Guid.NewGuid().ToString(),["data"]=new JsonObject{["title"]="Navigator",["level"]=2}};var first=StoryJson.Object(await f.Portals.WriteAsync(p,f.Player.Id.ToString(),null,input));var retry=StoryJson.Object(await f.Portals.WriteAsync(p,f.Player.Id.ToString(),null,input));Assert.Equal(first.Text("id"),retry.Text("id"));
  input["operationId"]=Guid.NewGuid().ToString();Assert.Equal("character_already_exists",(await Assert.ThrowsAsync<StoryException>(()=>f.Portals.WriteAsync(p,f.Player.Id.ToString(),null,input))).Code);
  foreach(var bad in new[]{new JsonObject{["level"]=6},new JsonObject{["gid"]="bespoke"},new JsonObject{["access_token"]="secret"}})await Assert.ThrowsAsync<StoryException>(()=>f.Portals.WriteAsync(p,f.Player.Id.ToString(),first.Text("id"),new(){["data"]=bad}));
  var config=p.Data.DeepClone().AsObject();config["character_fields"]!.AsObject()["account"]=new JsonObject{["type"]="string",["maxLength"]=80};Assert.Throws<StoryException>(()=>new PortalSchema(config));
 }
}
