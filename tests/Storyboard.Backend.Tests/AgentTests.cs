using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Leaf.Plugins.Storyboard;
using Leaf.Sdk.Services;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Storyboard.Testing;

public sealed class AgentTests
{
    [Fact]
    public async Task CampaignChatUsesOnePersistentAgentSessionAndNeverFallsBackToOneshot()
    {
        await using var fixture = await Fixture.Create();
        using var client = await fixture.Host();
        var path = "/campaigns/" + fixture.Campaign.Id + "/agent/chat";

        using (var denied = await fixture.PublicRequest(path, actor: fixture.Player))
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(denied)).StatusCode);

        JsonObject first;
        using (var read = await fixture.PublicRequest(path, actor: fixture.Gm))
        {
            var response = await client.SendAsync(read);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            first = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
        }

        var operation = Guid.NewGuid().ToString();
        var body = new JsonObject { ["content"] = "What should I prepare next?", ["operationId"] = operation }.ToJsonString();
        string admittedUid;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var send = await fixture.PublicRequest(path, "POST", body, fixture.Gm);
            var response = await client.SendAsync(send);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var admission = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
            admittedUid = admission.Text("messageUid");
            Assert.Equal("user:" + operation, admittedUid);
        }

        JsonObject second;
        using (var read = await fixture.PublicRequest(path, actor: fixture.Gm))
        {
            var response = await client.SendAsync(read);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            second = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
        }

        Assert.Equal(first.Text("sessionId"), second.Text("sessionId"));
        Assert.Equal(first.Text("discussionId"), second.Text("discussionId"));
        Assert.Equal(1, fixture.AgentConversations.Opens);
        Assert.Equal(1, fixture.AgentConversations.Sends);
        Assert.Empty(fixture.Compute.Requests);
        var messages = second["messages"]!.AsArray().Select(value => StoryJson.Object(value!)).ToArray();
        Assert.Equal(2, messages.Length);
        Assert.Contains(messages, value => value.Text("role") == "user" && value.Text("content") == "What should I prepare next?");
        Assert.Contains(messages, value => value.Text("role") == "assistant" && value.Text("content") == "Fixture campaign answer");

        var campaign = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var agent = (await fixture.Entities.GetAsync(StoryJson.Id(campaign.Data.Text("agent"))))!;
        var discussion = (await fixture.Entities.GetAsync(StoryJson.Id(campaign.Data.Text("agent_discussion"))))!;
        Assert.Equal("agent", agent.TypeSlug);
        Assert.Equal(campaign.Data.Text("workspace"), agent.Data.Text("workspace"));
        Assert.Equal("discussion", discussion.TypeSlug);
        Assert.Equal("nova", discussion.Data.Text("app"));
        Assert.Equal("storyboard", discussion.Data.Text("source_app"));
        Assert.Equal("chat", discussion.Data.Text("type"));
        Assert.Equal("storyboard-campaign", discussion.Data.Text("conversation_kind"));
        Assert.Equal(campaign.Id.ToString(), discussion.Data.Text("campaign"));

        // Reconstructing the product service simulates a plugin restart. The durable
        // campaign binding must reopen no new model session.
        var reconstructed = new StoryCampaignAgent(
            fixture.Store,
            fixture.Campaigns,
            fixture.Workspace,
            fixture.Transcript,
            fixture.Cockpit,
            fixture.Discussions,
            [fixture.AgentConversations]);
        await reconstructed.ReadAsync(campaign.Id.ToString(), fixture.Gm.Id.ToString(), null, null);
        Assert.Equal(1, fixture.AgentConversations.Opens);
    }

    [Fact]
    public async Task CampaignToolsRequireTheBoundCampaignAgentExecutionIdentity()
    {
        await using var fixture = await Fixture.Create();
        await fixture.Agent.ReadAsync(fixture.Campaign.Id.ToString(), fixture.Gm.Id.ToString(), null, null);
        var campaign = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;

        static DefaultHttpContext Context(string agentId)
        {
            var identity = new JsonObject
            {
                ["actor"] = new JsonObject { ["kind"] = "agent", ["id"] = agentId },
            };
            var context = new DefaultHttpContext();
            context.User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim("token_use", "execution"), new Claim("execution_identity", identity.ToJsonString())],
                "Bearer"));
            return context;
        }

        var wrong = Context(Guid.NewGuid().ToString());
        var denied = await Assert.ThrowsAsync<StoryException>(() => fixture.Agent.ContextAsync(campaign.Id.ToString(), wrong));
        Assert.Equal("campaign_agent_required", denied.Code);

        var accepted = StoryJson.Object(await fixture.Agent.ContextAsync(
            campaign.Id.ToString(), Context(campaign.Data.Text("agent"))));
        Assert.Equal(campaign.Id.ToString(), accepted["campaign"]!.AsObject().Text("id"));
    }
}
