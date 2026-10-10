using System.Text.Json.Nodes;
using Leaf.Sdk;
using Leaf.Sdk.Services;
using Microsoft.AspNetCore.Http;

namespace Leaf.Plugins.Storyboard;

public sealed record CampaignAgentMessageWrite(string Content, string OperationId);
public sealed record CampaignAgentProposalWrite(
    string EntityId,
    string Title,
    string Summary,
    string[]? Evidence,
    string? Confidence,
    string OperationId);

internal sealed record CampaignConversation(
    LeafEntity Campaign,
    LeafEntity Agent,
    LeafEntity Discussion,
    ExternalConversationHandle Handle);

/// <summary>
/// Binds one Storyboard campaign to the kernel Agent primitive and Nova's
/// persistent external-conversation runtime. Storyboard owns membership and
/// presentation; RedCompute remains the canonical transcript owner.
/// </summary>
public sealed class StoryCampaignAgent(
    StoryStore store,
    StoryCampaigns campaigns,
    StoryWorkspace workspace,
    StoryTranscript transcript,
    StoryCockpit cockpit,
    IDiscussions discussions,
    IEnumerable<IExternalAgentConversationProvider> providers)
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<object> ReadAsync(
        string campaignId,
        string accountId,
        string? afterEpoch,
        long? afterSequence,
        CancellationToken ct = default)
    {
        await campaigns.MembershipAsync(campaignId, accountId, true, ct);
        var conversation = await EnsureAsync(campaignId, ct);
        ExternalConversationCursor? after = null;
        if (!string.IsNullOrWhiteSpace(afterEpoch) || afterSequence.HasValue)
        {
            if (string.IsNullOrWhiteSpace(afterEpoch) || afterSequence is null or < 0)
                throw new StoryException("invalid_agent_cursor");
            after = new ExternalConversationCursor(afterEpoch, afterSequence.Value);
        }

        var provider = Provider(conversation.Agent.Id.ToString());
        ExternalConversationPage page;
        if (after is null)
        {
            // A null provider cursor intentionally means "newest page". Probe it only
            // to learn the current epoch, then hydrate from sequence zero so a reload
            // cannot silently omit the beginning of a long campaign conversation.
            var newest = await provider.ReadSettledAsync(conversation.Handle, null, 1, ct);
            page = newest.NextCursor is null
                ? newest
                : await provider.ReadSettledAsync(
                    conversation.Handle,
                    new ExternalConversationCursor(newest.NextCursor.Epoch, 0),
                    500,
                    ct);
        }
        else
        {
            page = await provider.ReadSettledAsync(conversation.Handle, after, 500, ct);
        }
        return new
        {
            agent = new { id = conversation.Agent.Id, name = conversation.Agent.Name },
            discussionId = conversation.Discussion.Data.Text("discussion_id"),
            sessionId = conversation.Handle.SessionId,
            messages = page.Messages,
            cursor = page.NextCursor,
            page.IsQuiescent,
            page.HasMore,
        };
    }

    public async Task<object> SendAsync(
        string campaignId,
        string accountId,
        CampaignAgentMessageWrite input,
        CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_json");
        var content = StoryJson.Bounded(input.Content, 20_000, true);
        var operation = StoryJson.Id(input.OperationId).ToString();
        await campaigns.MembershipAsync(campaignId, accountId, true, ct);
        var account = await store.RequireAsync("storyboard-account", accountId, ct);
        var conversation = await EnsureAsync(campaignId, ct);
        var config = await store.ConfigAsync(ct) ?? throw new StoryException("storyboard_not_configured", 503);
        var admission = await Provider(conversation.Agent.Id.ToString()).SendAsync(
            conversation.Handle,
            new ExternalConversationInput(
                operation,
                new ExternalRequestor(account.Id.ToString(), account.Name),
                content,
                [],
                new JsonObject
                {
                    ["transport"] = "storyboard",
                    ["application_id"] = "storyboard",
                    ["binding_id"] = conversation.Handle.BindingId,
                    ["generation"] = conversation.Handle.Generation,
                    ["owner_user_id"] = config.Data.Text("owner_id"),
                    ["agent_id"] = conversation.Agent.Id.ToString(),
                    ["campaign_id"] = campaignId,
                    ["account_id"] = accountId,
                }),
            ct);
        return new
        {
            accepted = true,
            admission.MessageUid,
            admission.Disposition,
            admission.QueueItemId,
            sessionId = conversation.Handle.SessionId,
            discussionId = conversation.Discussion.Data.Text("discussion_id"),
        };
    }

    public async Task<object> ContextAsync(string campaignId, HttpContext http, CancellationToken ct = default)
    {
        var conversation = await RequireCampaignAgentAsync(campaignId, http, ct);
        var campaign = conversation.Campaign;
        var entities = await workspace.AgentEntitiesAsync(campaignId, 200, ct);
        var current = (await store.AllAsync(
                "storyboard-campaign-session",
                new Dictionary<string, object?> { ["campaign"] = campaignId, ["state"] = "active" },
                ct))
            .OrderByDescending(value => value.CreatedAt)
            .FirstOrDefault();
        object[] events = [];
        if (current is not null)
        {
            var recent = await transcript.AgentEventsAsync(campaignId, current.Id.ToString(), 30, ct);
            events = recent.Select(value => new
            {
                id = value.Data.Text("event_id"),
                kind = value.Data.Text("kind"),
                channel = value.Data.Text("channel"),
                text = value.Data.Text("text"),
                actor = value.Data["actor"]?.DeepClone(),
                occurredAt = value.Data.Text("occurred_at", value.CreatedAt.ToString("O")),
            }).ToArray<object>();
        }
        return new
        {
            campaign = new
            {
                id = campaign.Id,
                campaign.Name,
                description = campaign.Data.Text("description"),
                summary = campaign.Data.Text("summary"),
                workspace = campaign.Data.Text("workspace"),
            },
            session = current is null ? null : new
            {
                id = current.Id,
                current.Name,
                state = current.Data.Text("state"),
                roleplayAnchor = current.Data.Text("roleplay_anchor"),
            },
            events,
            entities,
        };
    }

    public async Task<object> ProposeAsync(
        string campaignId,
        HttpContext http,
        CampaignAgentProposalWrite input,
        CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_json");
        var conversation = await RequireCampaignAgentAsync(campaignId, http, ct);
        return await cockpit.ProposeAsync(
            campaignId,
            conversation.Agent.Id.ToString(),
            input,
            ct);
    }

    private async Task<CampaignConversation> EnsureAsync(string campaignId, CancellationToken ct)
    {
        var campaign = await store.RequireAsync("storyboard-campaign", campaignId, ct);
        var existing = await ReadBindingAsync(campaign, ct);
        if (existing is not null) return existing;

        await gate.WaitAsync(ct);
        try
        {
            campaign = await store.RequireAsync("storyboard-campaign", campaignId, ct);
            existing = await ReadBindingAsync(campaign, ct);
            if (existing is not null) return existing;

            var config = await store.ConfigAsync(ct) ?? throw new StoryException("storyboard_not_configured", 503);
            var owningAgent = await store.Entities.GetAsync(StoryJson.Id(config.Data.Text("owner_agent_id")), ct)
                              ?? throw new StoryException("owning_agent_required", 503);
            var agentSlug = "storyboard-" + campaign.Id.ToString("N");
            var agentData = new JsonObject
            {
                ["description"] = $"Campaign copilot for {campaign.Name}",
                ["identity"] = Identity(campaign),
                ["output_protocol"] = OutputProtocol,
                ["capabilities"] = Capabilities(campaign),
                ["workspace"] = campaign.Data.Text("workspace"),
                ["owner_id"] = config.Data.Text("owner_id"),
                ["skills"] = new JsonArray(),
            };
            Copy(owningAgent.Data, agentData, "provider");
            Copy(owningAgent.Data, agentData, "quality_tier");
            var agent = await store.Entities.UpsertBySlugAsync(
                "agent", agentSlug, campaign.Name + " Copilot", agentData, ct);

            var bindingId = "storyboard:campaign:" + campaign.Id.ToString("N");
            var provider = Provider(agent.Id.ToString());
            var handle = await provider.OpenAsync(
                new ExternalConversationOpenRequest(
                    bindingId,
                    1,
                    agent.Id.ToString(),
                    config.Data.Text("owner_id"),
                    "storyboard-gm",
                    new ExternalConversationScope(
                        "storyboard",
                        "storyboard",
                        campaign.Id.ToString(),
                        "storyboard-campaign",
                        config.Data.Text("installation")),
                    "storyboard-agent-open:" + campaign.Id.ToString("N")),
                ct);

            var discussion = await FindDiscussionAsync(campaign.Id.ToString(), ct)
                             ?? await discussions.CreateAsync(
                                 campaign.Name,
                                 agent.Id.ToString(),
                                 new JsonObject
                                 {
                                     ["discussion_id"] = "sb" + campaign.Id.ToString("N")[..14],
                                     ["app"] = "nova",
                                     ["source_app"] = "storyboard",
                                     ["campaign"] = campaign.Id.ToString(),
                                     ["workspace"] = campaign.Data.Text("workspace"),
                                     ["owner_id"] = config.Data.Text("owner_id"),
                                     ["owner_agent_id"] = agent.Id.ToString(),
                                     ["agent"] = agent.Id.ToString(),
                                     ["session_id"] = handle.SessionId,
                                     ["type"] = "chat",
                                     ["conversation_kind"] = "storyboard-campaign",
                                     ["status"] = "idle",
                                     ["confidential"] = true,
                                     ["title_source"] = "system",
                                     ["conversation_revision"] = 0,
                                     ["read_conversation_revision"] = 0,
                                     ["last_processed_session_assistant_uid"] = "",
                                 },
                                 ct);

            campaign = await store.ChangeAsync(campaign.TypeSlug, campaign.Slug, campaign.Name, old =>
            {
                var next = old!.Data.DeepClone().AsObject();
                next["agent"] = agent.Id.ToString();
                next["agent_binding"] = handle.BindingId;
                next["agent_generation"] = handle.Generation;
                next["agent_conversation"] = handle.ConversationId;
                next["agent_session"] = handle.SessionId;
                next["agent_discussion"] = discussion.Id.ToString();
                return next;
            }, ct);
            return new CampaignConversation(campaign, agent, discussion, handle);
        }
        finally { gate.Release(); }
    }

    private async Task<CampaignConversation?> ReadBindingAsync(LeafEntity campaign, CancellationToken ct)
    {
        var agentId = campaign.Data.Text("agent");
        var bindingId = campaign.Data.Text("agent_binding");
        var conversationId = campaign.Data.Text("agent_conversation");
        var sessionId = campaign.Data.Text("agent_session");
        var discussionId = campaign.Data.Text("agent_discussion");
        var generation = (long)campaign.Data.Number("agent_generation");
        if (!Guid.TryParse(agentId, out var agentGuid)
            || string.IsNullOrWhiteSpace(bindingId)
            || string.IsNullOrWhiteSpace(conversationId)
            || string.IsNullOrWhiteSpace(sessionId)
            || !Guid.TryParse(discussionId, out var discussionGuid)
            || generation < 1)
            return null;
        var agent = await store.Entities.GetAsync(agentGuid, ct);
        var discussion = await store.Entities.GetAsync(discussionGuid, ct);
        if (agent?.TypeSlug != "agent" || discussion?.TypeSlug != "discussion") return null;
        return new CampaignConversation(
            campaign,
            agent,
            discussion,
            new ExternalConversationHandle(
                Provider(agentId).ProviderId,
                bindingId,
                generation,
                conversationId,
                sessionId));
    }

    private async Task<LeafEntity?> FindDiscussionAsync(string campaignId, CancellationToken ct)
        => (await store.Entities.QueryAsync(new EntityQuery
        {
            TypeSlug = "discussion",
            DataEquals = new Dictionary<string, object?>
            {
                ["app"] = "nova",
                ["source_app"] = "storyboard",
                ["campaign"] = campaignId,
            },
            Limit = 2,
        }, ct)).SingleOrDefault();

    private IExternalAgentConversationProvider Provider(string agentId)
        => providers.FirstOrDefault(value => value.CanHandle(agentId))
           ?? throw new StoryException("agent_runtime_unavailable", 503);

    private async Task<CampaignConversation> RequireCampaignAgentAsync(
        string campaignId,
        HttpContext http,
        CancellationToken ct)
    {
        var conversation = await EnsureAsync(campaignId, ct);
        if (http.User.FindFirst("token_use")?.Value != "execution")
            throw new StoryException("campaign_agent_required", 403);
        var identity = JsonNode.Parse(http.User.FindFirst("execution_identity")?.Value ?? "null") as JsonObject;
        var actor = identity?["actor"] as JsonObject;
        var actorId = actor?.Text("entityId", actor.Text("id")) ?? "";
        if (actor?.Text("kind") != "agent" || actorId != conversation.Agent.Id.ToString())
            throw new StoryException("campaign_agent_required", 403);
        return conversation;
    }

    private static void Copy(JsonObject source, JsonObject target, string key)
    {
        if (source[key] is not null) target[key] = source[key]!.DeepClone();
    }

    private static string Identity(LeafEntity campaign) => $$"""
        # {{campaign.Name}} Campaign Copilot

        You are the persistent Game Master collaborator for exactly one Storyboard campaign:
        `{{campaign.Id}}`. Your workspace is this campaign's canonical workspace. Nothing outside
        that workspace belongs to your world.

        Maintain five distinct views: what is happening now, what was supposed to happen, what
        actually happened, what the players have discovered, and what they currently believe.
        Help prepare, run and review sessions. Retrieve evidence before making claims. Propose
        useful context early, but never invent canon or silently decide what players know.

        Campaign-scoped tools:
        - GET http://127.0.0.1:18804/api/apps/storyboard/campaigns/{{campaign.Id}}/agent/context
        - POST http://127.0.0.1:18804/api/apps/storyboard/campaigns/{{campaign.Id}}/agent/cockpit/proposals

        Send `Authorization: Bearer $REDLEAF_EXECUTION_TOKEN` only to trusted loopback RedLeaf.
        The API verifies that you are this campaign's Agent. Never print, log or forward the token.
        Do not call generic entity, discussion, search, filesystem, or application APIs to escape
        the campaign boundary.
        """;

    private const string OutputProtocol = """
        Lead with the useful conclusion. Keep table-time answers compact. Use visible commentary
        for meaningful progress, then a clear final answer. Cite the campaign evidence you used.
        Never expose hidden chain-of-thought. Label uncertain ideas as proposals, not canon.
        """;

    private static string Capabilities(LeafEntity campaign) => $$"""
        You can read the canonical campaign workspace and recent table transcript through the
        campaign-scoped Storyboard context tool. You can submit grounded cockpit proposals for GM
        approval. You may draft image, music and prompt briefs in chat; paid generation and canon
        mutation require explicit GM confirmation. Campaign id: {{campaign.Id}}.
        """;
}
