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
    public async Task CampaignAgentSettingsUpdateTheCanonicalAgentWithoutReplacingConversations()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var account = fixture.Gm.Id.ToString();
        var before = StoryJson.Object(await fixture.Agent.ReadAsync(campaign, account, null, null));
        var binding = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var agentId = binding.Data.Text("agent");

        var operation = Guid.NewGuid().ToString();
        var write = new CampaignAgentSettingsWrite("Keeper of Embers", "Challenge weak clues and protect the campaign's melancholy tone.", "concise", "proactive", 0, operation);
        var saved = StoryJson.Object(await fixture.Agent.SaveSettingsAsync(campaign, account, write));
        var retried = StoryJson.Object(await fixture.Agent.SaveSettingsAsync(campaign, account, write));

        Assert.Equal("Keeper of Embers", saved["agent"]!.AsObject().Text("name"));
        Assert.Equal("concise", saved.Text("responseStyle"));
        Assert.Equal("proactive", saved.Text("initiative"));
        Assert.Equal(1, saved.Number("revision"));
        Assert.Equal(1, retried.Number("revision"));
        var after = StoryJson.Object(await fixture.Agent.ReadAsync(campaign, account, null, null));
        var updatedCampaign = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var agent = (await fixture.Entities.GetAsync(StoryJson.Id(agentId)))!;
        Assert.Equal(agentId, updatedCampaign.Data.Text("agent"));
        Assert.Equal(before.Text("discussionId"), after.Text("discussionId"));
        Assert.Equal(before.Text("sessionId"), after.Text("sessionId"));
        Assert.Equal("Keeper of Embers", agent.Name);
        Assert.Contains("Challenge weak clues", agent.Data.Text("identity"));
        Assert.Equal(1, fixture.AgentConversations.Opens);

        var stale = await Assert.ThrowsAsync<StoryException>(() => fixture.Agent.SaveSettingsAsync(campaign, account, new CampaignAgentSettingsWrite(
            "Stale", "", "balanced", "collaborative", 0, Guid.NewGuid().ToString())));
        Assert.Equal("agent_settings_changed", stale.Code);
        Assert.Equal(409, stale.Status);
    }

    [Fact]
    public async Task CampaignAgentSettingsRemainGameMasterOnly()
    {
        await using var fixture = await Fixture.Create();
        var denied = await Assert.ThrowsAsync<StoryException>(() => fixture.Agent.SettingsAsync(fixture.Campaign.Id.ToString(), fixture.Player.Id.ToString()));
        Assert.Equal("game_master_required", denied.Code);
    }

    [Fact]
    public async Task CampaignAgentAvatarUploadAndResetKeepTheSameAgentBinding()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var account = fixture.Gm.Id.ToString();
        var before = StoryJson.Object(await fixture.Agent.ReadAsync(campaign, account, null, null));
        var campaignEntity = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var agentId = campaignEntity.Data.Text("agent");
        var png = new byte[80]; png[0] = 0x89; png[1] = 0x50; png[2] = 0x4e; png[3] = 0x47; png[12] = (byte)'I'; png[13] = (byte)'H'; png[14] = (byte)'D'; png[15] = (byte)'R';
        var uploaded = StoryJson.Object(await fixture.Agent.SaveAvatarAsync(campaign, account, new CampaignAgentAvatarWrite(Convert.ToBase64String(png), "image/png", false, 0, Guid.NewGuid().ToString())));
        Assert.Equal(1, uploaded.Number("revision"));
        var reset = StoryJson.Object(await fixture.Agent.SaveAvatarAsync(campaign, account, new CampaignAgentAvatarWrite(null, null, true, 1, Guid.NewGuid().ToString())));
        Assert.Equal(2, reset.Number("revision"));
        var after = StoryJson.Object(await fixture.Agent.ReadAsync(campaign, account, null, null));
        var updatedCampaign = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        Assert.Equal(agentId, updatedCampaign.Data.Text("agent"));
        Assert.Equal(before.Text("discussionId"), after.Text("discussionId"));
        Assert.Equal(before.Text("sessionId"), after.Text("sessionId"));
        Assert.Equal(1, fixture.AgentConversations.Opens);
    }

    [Fact]
    public async Task CampaignAgentAvatarIsServedThroughTheProtectedCampaignRoute()
    {
        await using var fixture = await Fixture.Create();
        using var client = await fixture.Host();
        var path = $"/campaigns/{fixture.Campaign.Id}/agent/avatar";

        using var gmRequest = await fixture.PublicRequest(path, actor: fixture.Gm);
        using var gmResponse = await client.SendAsync(gmRequest);
        Assert.Equal(System.Net.HttpStatusCode.OK, gmResponse.StatusCode);
        Assert.Equal("image/png", gmResponse.Content.Headers.ContentType?.MediaType);
        Assert.Equal([1, 2, 3], await gmResponse.Content.ReadAsByteArrayAsync());

        using var playerRequest = await fixture.PublicRequest(path, actor: fixture.Player);
        using var playerResponse = await client.SendAsync(playerRequest);
        Assert.Equal(System.Net.HttpStatusCode.Forbidden, playerResponse.StatusCode);
    }

    [Fact]
    public async Task CampaignAgentKeepsIndependentPersistentDiscussionsAndSessions()
    {
        await using var fixture = await Fixture.Create();
        var campaignId = fixture.Campaign.Id.ToString();
        var accountId = fixture.Gm.Id.ToString();

        var firstIndex = StoryJson.Object(await fixture.Agent.ListAsync(campaignId, accountId));
        var firstId = firstIndex.Text("defaultDiscussionId");
        Assert.Single(firstIndex["discussions"]!.AsArray());

        var createOperation = Guid.NewGuid().ToString();
        var created = StoryJson.Object(await fixture.Agent.CreateAsync(
            campaignId, accountId, new CampaignAgentDiscussionWrite(createOperation)));
        var retried = StoryJson.Object(await fixture.Agent.CreateAsync(
            campaignId, accountId, new CampaignAgentDiscussionWrite(createOperation)));
        Assert.Equal(created.Text("id"), retried.Text("id"));
        Assert.NotEqual(firstId, created.Text("id"));
        Assert.Equal(2, fixture.AgentConversations.Opens);

        await fixture.Agent.SendAsync(
            campaignId,
            accountId,
            firstId,
            new CampaignAgentMessageWrite("Prepare the first room", Guid.NewGuid().ToString()));
        await fixture.Agent.SendAsync(
            campaignId,
            accountId,
            created.Text("id"),
            new CampaignAgentMessageWrite("Track the rival faction", Guid.NewGuid().ToString()));

        var first = StoryJson.Object(await fixture.Agent.ReadAsync(
            campaignId, accountId, firstId, null, null));
        var second = StoryJson.Object(await fixture.Agent.ReadAsync(
            campaignId, accountId, created.Text("id"), null, null));
        var firstText = first["messages"]!.AsArray().Select(value => StoryJson.Object(value!).Text("content")).ToArray();
        var secondText = second["messages"]!.AsArray().Select(value => StoryJson.Object(value!).Text("content")).ToArray();
        Assert.Contains("Prepare the first room", firstText);
        Assert.DoesNotContain("Track the rival faction", firstText);
        Assert.Contains("Track the rival faction", secondText);
        Assert.DoesNotContain("Prepare the first room", secondText);
        Assert.NotEqual(first.Text("sessionId"), second.Text("sessionId"));

        var index = StoryJson.Object(await fixture.Agent.ListAsync(campaignId, accountId));
        Assert.Equal(2, index["discussions"]!.AsArray().Count);
        Assert.Contains(index["discussions"]!.AsArray(), value =>
            StoryJson.Object(value!).Text("title") == "Track the rival faction");

        var reconstructed = new StoryCampaignAgent(
            fixture.Store,
            fixture.Campaigns,
            fixture.Workspace,
            fixture.Transcript,
            fixture.Cockpit,
            fixture.Compute,
            fixture.Discussions,
            [fixture.AgentConversations]);
        var afterRestart = StoryJson.Object(await reconstructed.ReadAsync(
            campaignId, accountId, created.Text("id"), null, null));
        Assert.Equal(second.Text("sessionId"), afterRestart.Text("sessionId"));
        Assert.Equal(2, fixture.AgentConversations.Opens);
    }

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
        Assert.Equal("/api/assets/fixture-cover.png", agent.Data.Text("avatar"));
        Assert.Single(agent.Data["skills"]!.AsArray());
        Assert.Equal("discussion", discussion.TypeSlug);
        Assert.Equal("nova", discussion.Data.Text("app"));
        Assert.Equal("storyboard", discussion.Data.Text("source_app"));
        Assert.Equal("chat", discussion.Data.Text("type"));
        Assert.Equal("storyboard-campaign", discussion.Data.Text("conversation_kind"));
        Assert.Equal(campaign.Id.ToString(), discussion.Data.Text("campaign"));
        Assert.Equal(agent.Id.ToString(), discussion.Data.Text("agent"));
        Assert.False(discussion.Data.Flag("confidential"));

        // Reconstructing the product service simulates a plugin restart. The durable
        // campaign binding must reopen no new model session.
        var reconstructed = new StoryCampaignAgent(
            fixture.Store,
            fixture.Campaigns,
            fixture.Workspace,
            fixture.Transcript,
            fixture.Cockpit,
            fixture.Compute,
            fixture.Discussions,
            [fixture.AgentConversations]);
        await reconstructed.ReadAsync(campaign.Id.ToString(), fixture.Gm.Id.ToString(), null, null);
        Assert.Equal(1, fixture.AgentConversations.Opens);
    }

    [Fact]
    public async Task ExistingCampaignDiscussionBecomesOrdinaryWithoutChangingItsBinding()
    {
        await using var fixture = await Fixture.Create();
        var first = StoryJson.Object(await fixture.Agent.ReadAsync(
            fixture.Campaign.Id.ToString(), fixture.Gm.Id.ToString(), null, null));
        var campaign = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var discussionId = StoryJson.Id(campaign.Data.Text("agent_discussion"));
        await fixture.Entities.PatchAsync(discussionId, new JsonObject { ["confidential"] = true });

        var second = StoryJson.Object(await fixture.Agent.ReadAsync(
            fixture.Campaign.Id.ToString(), fixture.Gm.Id.ToString(), null, null));
        var discussion = (await fixture.Entities.GetAsync(discussionId))!;

        Assert.False(discussion.Data.Flag("confidential"));
        Assert.Equal(first.Text("discussionId"), second.Text("discussionId"));
        Assert.Equal(first.Text("sessionId"), second.Text("sessionId"));
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

    [Fact]
    public async Task ScopedWorkspaceToolsAllowInteractiveAgentAndRejectHeartbeatMutation()
    {
        await using var fixture = await Fixture.Create();
        var campaignId = fixture.Campaign.Id.ToString();
        await fixture.Agent.ReadAsync(campaignId, fixture.Gm.Id.ToString(), null, null);
        var campaign = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var root = (await fixture.Entities.GetAsync(StoryJson.Id(campaign.Data.Text("workspace"))))!;
        await fixture.Entities.UpsertBySlugAsync("entity-type", "fixture-note", "Fixture note", new JsonObject
        {
            ["scope"] = root.Slug,
            ["system"] = false,
        });

        var playbooks = new StoryAgentPlaybooks(fixture.Store, fixture.Campaigns);
        var play = new StoryCampaignPlay(fixture.Store, fixture.Campaigns, fixture.Agent, new FakeWorkflowAutomations(fixture.Entities));
        var tools = new StoryCampaignAgentTools(
            fixture.Store,
            fixture.Agent,
            fixture.Campaigns,
            fixture.Workspace,
            fixture.Transcript,
            fixture.Cockpit,
            play,
            playbooks,
            null!,
            fixture.Visuals);

        static DefaultHttpContext Context(string agentId, string sessionId)
        {
            var identity = new JsonObject
            {
                ["actor"] = new JsonObject { ["kind"] = "agent", ["entityId"] = agentId },
                ["context"] = new JsonArray(new JsonObject { ["kind"] = "session", ["id"] = sessionId }),
            };
            var context = new DefaultHttpContext();
            context.User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim("token_use", "execution"), new Claim("execution_identity", identity.ToJsonString())],
                "Bearer"));
            return context;
        }

        var normal = (await fixture.Entities.QueryAsync(new Leaf.Sdk.EntityQuery
        {
            TypeSlug = "discussion",
            DataEquals = new Dictionary<string, object?> { ["campaign"] = campaignId },
            Limit = 200,
        })).Single(value => value.Data.Text("conversation_kind") == "storyboard-campaign");
        var created = StoryJson.Object(await tools.WorkspaceCreateAsync(
            campaignId,
            Context(campaign.Data.Text("agent"), normal.Data.Text("session_id")),
            new WorkspaceEntityCreate("fixture-note", "Agent-authored note", null, new JsonObject()),
            default));
        Assert.Equal("fixture-note", created.Text("typeSlug"));

        await play.SetAsync(campaignId, fixture.Gm.Id.ToString(), new CampaignPlayWrite(true, Guid.NewGuid().ToString()));
        var heartbeat = (await fixture.Entities.QueryAsync(new Leaf.Sdk.EntityQuery
        {
            TypeSlug = "discussion",
            DataEquals = new Dictionary<string, object?> { ["campaign"] = campaignId },
            Limit = 200,
        })).Single(value => value.Data.Text("conversation_kind") == "storyboard-campaign-heartbeat");
        var denied = await Assert.ThrowsAsync<StoryException>(() => tools.WorkspaceCreateAsync(
            campaignId,
            Context(campaign.Data.Text("agent"), heartbeat.Data.Text("session_id")),
            new WorkspaceEntityCreate("fixture-note", "Autonomous canon", null, new JsonObject()),
            default));
        Assert.Equal("interactive_agent_discussion_required", denied.Code);
    }

    [Fact]
    public async Task PlayModeOwnsOneAutomationHeartbeatDiscussionAndRevisionedPlaybooks()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var account = fixture.Gm.Id.ToString();
        var playbooks = new StoryAgentPlaybooks(fixture.Store, fixture.Campaigns);
        var defaults = StoryJson.Object(await playbooks.ListAsync(campaign, account));
        Assert.Equal(5, defaults["items"]!.AsArray().Count);

        var saved = StoryJson.Object(await playbooks.SaveAsync(campaign, account, "music", new CampaignPlaybookWrite(
            true, true, 90, ["scene-change", "queue-low"], "Brass motifs for the Concord.", "No generic trailer music.", 0, Guid.NewGuid().ToString())));
        Assert.Equal(1, saved.Number("revision"));
        Assert.True(saved.Flag("autoDrafts"));
        Assert.NotEmpty(saved.Text("revisionHash"));

        var workflows = new FakeWorkflowAutomations(fixture.Entities);
        var play = new StoryCampaignPlay(fixture.Store, fixture.Campaigns, fixture.Agent, workflows);
        var started = StoryJson.Object(await play.SetAsync(campaign, account, new CampaignPlayWrite(true, Guid.NewGuid().ToString())));
        Assert.True(started.Flag("enabled"));
        Assert.NotEmpty(started.Text("heartbeatDiscussionId"));
        Assert.True(workflows.Last!.Enabled);
        Assert.Equal(StoryCampaignPlay.ActionType, workflows.Last.NodeType);

        var automation = await fixture.Entities.GetBySlugAsync("automation", workflows.Last.Slug);
        var sends = fixture.AgentConversations.Sends;
        var heartbeatResult = await new StoryCampaignHeartbeatHandler(play, playbooks, fixture.Agent).ExecuteAsync(new AutomationActionContext
        {
            Automation = automation!,
            ActionConfig = workflows.Last.ActionConfig,
            Beneficiary = new ComputeBeneficiary("user", account),
            AttemptJobId = Guid.NewGuid(),
            CorrelationId = Guid.NewGuid().ToString(),
            Confidential = true,
        }, default);
        Assert.Equal(sends + 1, fixture.AgentConversations.Sends);
        var heartbeat = heartbeatResult ?? throw new Xunit.Sdk.XunitException("Heartbeat returned no result");
        Assert.Equal(started.Text("heartbeatDiscussionId"), heartbeat.Text("discussionId"));
        Assert.False(string.IsNullOrWhiteSpace(heartbeat.Text("playbookHash")));

        var index = StoryJson.Object(await fixture.Agent.ListAsync(campaign, account));
        var heartbeatDiscussion = index["discussions"]!.AsArray().Select(value => StoryJson.Object(value!)).Single(value => value.Text("kind") == "heartbeat");
        Assert.True(heartbeatDiscussion.Flag("readOnly"));
        Assert.Equal(started.Text("heartbeatDiscussionId"), heartbeatDiscussion.Text("id"));

        var stopped = StoryJson.Object(await play.SetAsync(campaign, account, new CampaignPlayWrite(false, Guid.NewGuid().ToString())));
        Assert.False(stopped.Flag("enabled"));
        Assert.False(workflows.Last.Enabled);
        Assert.Equal(2, workflows.Upserts);
    }
}
