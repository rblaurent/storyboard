using RedBamboo.AppHost.Auth;
using Leaf.Plugins.Storyboard;
using System.Security.Claims;
using Xunit;
namespace Storyboard.Testing;
// Tests the actual shared host policy project supplied by the caller. It is a
// test-only reference; the product continues to reference only Leaf.Sdk.
public sealed class KernelPolicyTests {
 private static ClaimsPrincipal Human(string id,string auth="Cookies")=>new(new ClaimsIdentity([new Claim("sub",id)],auth));
 [Fact] public async Task ActualKernelPolicyAllowsExplicitOwnerAndOwningAgentAndRejectsOtherPrincipals(){await using var f=await Fixture.Create();var c=(await f.Store.ConfigAsync())!;var resource=new ConfidentialResource(c.Data.Text("owner_id"),c.Data.Text("owner_agent_id"),true);Assert.True(ConfidentialResourcePolicy.CanRead(Human(f.Owner),null,resource));Assert.False(ConfidentialResourcePolicy.CanRead(Human(f.Outsider.Id.ToString()),null,resource));Assert.False(ConfidentialResourcePolicy.CanRead(Human(f.Owner,"LocalDefault"),null,resource));Assert.False(ConfidentialResourcePolicy.CanRead(new ClaimsPrincipal(),null,resource));var execution=new ExecutionIdentity(1,Guid.NewGuid().ToString(),new("fixture","Fixture"),new("agent",resource.OwnerAgentId!,"Fixture Agent"),new("user",f.Owner),[]);Assert.True(ConfidentialResourcePolicy.CanRead(Human(f.Owner),execution,resource));Assert.False(ConfidentialResourcePolicy.CanRead(Human(f.Owner),execution with{Actor=execution.Actor with{Id=Guid.NewGuid().ToString()}},resource));}
 [Fact] public async Task EveryPrivateStoryboardRecordHasTheSameKernelReadableOwnerAgentBinding(){await using var f=await Fixture.Create();await f.Portal();await f.Character(f.Player);await f.Access.BeginAsync(new Microsoft.AspNetCore.Http.DefaultHttpContext(),default);await f.Access.IssueSessionAsync(f.Player.Id.ToString());var config=(await f.Store.ConfigAsync())!;foreach(var e in f.Entities.Snapshot().Where(e=>e.TypeSlug.StartsWith("storyboard-"))){var resource=new ConfidentialResource(e.Data.Text("owner_id"),e.Data.Text("owner_agent_id"),e.Data.Flag("confidential"));Assert.True(ConfidentialResourcePolicy.CanRead(Human(f.Owner),null,resource));Assert.Equal(config.Data.Text("owner_agent_id"),resource.OwnerAgentId);}}
}
