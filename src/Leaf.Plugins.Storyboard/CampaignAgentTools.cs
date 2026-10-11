using System.Text.Json.Nodes;
using Leaf.Sdk;
using Microsoft.AspNetCore.Http;

namespace Leaf.Plugins.Storyboard;

public sealed class StoryCampaignAgentTools(
    StoryStore store,
    StoryCampaignAgent agent,
    StoryCampaigns campaigns,
    StoryWorkspace workspace,
    StoryTranscript transcript,
    StoryCockpit cockpit,
    StoryCampaignPlay play,
    StoryAgentPlaybooks playbooks,
    StoryMusic music,
    StoryVisuals visuals)
{
    public async Task<object> StateAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        var actor = conversation.Campaign.Data.Text("creator");
        var playbookSnapshot = await playbooks.SnapshotAsync(campaign, ct);
        return new
        {
            campaign = new
            {
                id = conversation.Campaign.Id,
                conversation.Campaign.Name,
                description = conversation.Campaign.Data.Text("description"),
                summary = conversation.Campaign.Data.Text("summary"),
                workspace = conversation.Campaign.Data.Text("workspace"),
            },
            agent = new { id = conversation.Agent.Id, conversation.Agent.Name, avatar = conversation.Agent.Data.Text("avatar") },
            players = await campaigns.PlayersAsync(campaign, actor, ct),
            playMode = await play.StatusAsync(campaign, actor, ct),
            playbooks = new { revisionHash = playbookSnapshot.Hash, items = playbookSnapshot.Items },
            cockpit = await cockpit.SnapshotAsync(campaign, actor, ct),
            currentTranscript = await transcript.CurrentAsync(campaign, actor, ct),
            music = new
            {
                status = await Capture(() => music.StatusAsync(campaign, actor, ct)),
                playback = await Capture(async () => await music.StateAsync(campaign, actor, ct)),
                queue = await Capture(() => music.QueueAsync(campaign, actor, ct)),
            },
            visuals = new
            {
                profile = await Capture(() => visuals.ProfileAsync(campaign, actor, ct)),
                queue = await Capture(() => visuals.QueueAsync(campaign, actor, ct)),
                session = await Capture(() => visuals.SessionAsync(campaign, actor, ct)),
            },
        };
    }

    public async Task<object> WorkspaceAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await workspace.SnapshotAsync(campaign, conversation.Campaign.Data.Text("creator"), null, ct);
    }

    public async Task<object> WorkspaceEntitiesAsync(string campaign, HttpContext http, string? types, string? query, string? cursor, int? limit, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await workspace.ListAsync(campaign, conversation.Campaign.Data.Text("creator"), types, query, cursor, limit, null, ct);
    }

    public async Task<object> WorkspaceCreateAsync(string campaign, HttpContext http, WorkspaceEntityCreate input, CancellationToken ct)
    {
        var conversation = await RequireInteractiveAsync(campaign, http, ct);
        return await workspace.AgentCreateAsync(campaign, conversation.Agent.Id.ToString(), input, ct);
    }

    public async Task<object> WorkspaceSaveAsync(string campaign, string entity, HttpContext http, WorkspaceEntityWrite input, CancellationToken ct)
    {
        var conversation = await RequireInteractiveAsync(campaign, http, ct);
        return await workspace.AgentSaveAsync(campaign, conversation.Agent.Id.ToString(), entity, input, ct);
    }

    public async Task<object> PlayersAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await campaigns.PlayersAsync(campaign, conversation.Campaign.Data.Text("creator"), ct);
    }

    public async Task<object> TranscriptSessionsAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await transcript.SessionsAsync(campaign, conversation.Campaign.Data.Text("creator"), ct);
    }

    public async Task<object> TranscriptEventsAsync(string campaign, string session, HttpContext http, string? cursor, int? limit, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await transcript.PageAsync(campaign, session, conversation.Campaign.Data.Text("creator"), cursor, limit, ct);
    }

    public async Task<object> MusicAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        var actor = conversation.Campaign.Data.Text("creator");
        return new
        {
            status = await Capture(() => music.StatusAsync(campaign, actor, ct)),
            playlists = await Capture(() => music.PlaylistsAsync(campaign, actor, 0, 100, ct)),
            tracks = await Capture(() => music.TracksAsync(campaign, actor, ct)),
            playback = await Capture(async () => await music.StateAsync(campaign, actor, ct)),
            queue = await Capture(() => music.QueueAsync(campaign, actor, ct)),
        };
    }

    public async Task<object> MusicGenerationStatusAsync(string campaign, string operation, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await music.GenerationAsync(campaign, conversation.Campaign.Data.Text("creator"), operation, ct);
    }

    public async Task<object> VisualsAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        var actor = conversation.Campaign.Data.Text("creator");
        return new
        {
            profile = await visuals.ProfileAsync(campaign, actor, ct),
            library = await visuals.LibraryAsync(campaign, actor, ct),
            sets = await visuals.SetsAsync(campaign, actor, ct),
            queue = await visuals.QueueAsync(campaign, actor, ct),
            session = await visuals.SessionAsync(campaign, actor, ct),
        };
    }

    public async Task<object> VisualGenerationStatusAsync(string campaign, string operation, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        return await visuals.GenerationAsync(campaign, conversation.Campaign.Data.Text("creator"), operation, ct);
    }

    public async Task<object> PlaybooksAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        await agent.RequireCampaignAgentAsync(campaign, http, ct);
        var snapshot = await playbooks.SnapshotAsync(campaign, ct);
        return new
        {
            campaignId = campaign,
            revisionHash = snapshot.Hash,
            items = snapshot.Items,
            rule = "Structured policy controls when and what. Editable direction controls creative execution only.",
        };
    }

    public async Task<object> MusicFindAsync(string campaign, HttpContext http, MusicSituationWrite input, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        await playbooks.RequireEnabledAsync(campaign, "music", ct);
        return await music.FindAsync(campaign, conversation.Campaign.Data.Text("creator"), input, ct);
    }

    public async Task<object> VisualMatchAsync(string campaign, HttpContext http, VisualSituationWrite input, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        await playbooks.RequireEnabledAsync(campaign, "visuals", ct);
        return await visuals.MatchAsync(campaign, conversation.Campaign.Data.Text("creator"), input, ct);
    }

    public async Task<object> MusicGenerationAsync(string campaign, HttpContext http, MusicGenerationWrite input, CancellationToken ct)
    {
        if (input is null) throw new StoryException("invalid_json");
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        await RequirePlayModeAsync(campaign, ct);
        var playbook = await playbooks.RequireAutonomousDraftAsync(campaign, "music", ct);
        await RequireCooldownAsync(campaign, "storyboard-music-generation", playbook, input.OperationId, ct);
        return await music.StartGenerationAsync(campaign, conversation.Campaign.Data.Text("creator"), input with
        {
            Confirmed = true,
            PlaybookHash = playbook.Text("playbookHash"),
            HeartbeatTurn = ExecutionId(http),
        }, ct);
    }

    public async Task<object> VisualGenerationAsync(string campaign, HttpContext http, VisualGenerationWrite input, CancellationToken ct)
    {
        if (input is null) throw new StoryException("invalid_json");
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        await RequirePlayModeAsync(campaign, ct);
        var playbook = await playbooks.RequireAutonomousDraftAsync(campaign, "visuals", ct);
        await RequireCooldownAsync(campaign, "storyboard-visual-generation", playbook, input.OperationId, ct);
        return await visuals.StartGenerationAsync(campaign, conversation.Campaign.Data.Text("creator"), input with
        {
            Confirmed = true,
            PlaybookHash = playbook.Text("playbookHash"),
            HeartbeatTurn = ExecutionId(http),
        }, ct);
    }

    private async Task RequirePlayModeAsync(string campaign, CancellationToken ct)
    {
        var status = await play.EntityAsync(campaign, ct);
        if (status?.Data.Flag("enabled") != true) throw new StoryException("play_mode_inactive", 409);
    }

    private async Task RequireCooldownAsync(string campaign, string type, JsonObject playbook, string operationId, CancellationToken ct)
    {
        var operation = StoryJson.Id(operationId).ToString();
        var cooldown = Math.Clamp((int)playbook.Number("cooldownSeconds"), 15, 3_600);
        var latest = (await store.AllAsync(type, new Dictionary<string, object?>
        {
            ["campaign"] = campaign,
            ["agent_generated"] = true,
        }, ct)).OrderByDescending(value => value.CreatedAt).FirstOrDefault();
        if (latest is not null
            && latest.Data.Text("operation_id") != operation
            && DateTimeOffset.UtcNow - latest.CreatedAt < TimeSpan.FromSeconds(cooldown))
            throw new StoryException("agent_capability_cooldown", 429);
    }

    private static string ExecutionId(HttpContext http)
    {
        var identity = JsonNode.Parse(http.User.FindFirst("execution_identity")?.Value ?? "null") as JsonObject;
        var raw = identity is null ? "" : identity.Text("executionId", identity.Text("execution_id"));
        return raw is { Length: > 0 } value
            ? StoryJson.Bounded(value, 160)
            : "agent-session";
    }

    private async Task<CampaignConversation> RequireInteractiveAsync(string campaign, HttpContext http, CancellationToken ct)
    {
        var conversation = await agent.RequireCampaignAgentAsync(campaign, http, ct);
        var identity = JsonNode.Parse(http.User.FindFirst("execution_identity")?.Value ?? "null") as JsonObject;
        var sessionId = (identity?["context"] as JsonArray)?.OfType<JsonObject>()
            .FirstOrDefault(value => value.Text("kind") == "session")?.Text("id") ?? "";
        if (sessionId.Length == 0) throw new StoryException("interactive_agent_discussion_required", 403);
        var discussions = await store.Entities.QueryAsync(new EntityQuery
        {
            TypeSlug = "discussion",
            DataEquals = new Dictionary<string, object?>
            {
                ["app"] = "nova",
                ["source_app"] = "storyboard",
                ["campaign"] = campaign,
            },
            Limit = 200,
        }, ct);
        var discussion = discussions.SingleOrDefault(value => value.Data.Text("session_id") == sessionId);
        if (discussion is null
            || discussion.Data.Text("agent") != conversation.Agent.Id.ToString()
            || discussion.Data.Text("conversation_kind") == "storyboard-campaign-heartbeat")
            throw new StoryException("interactive_agent_discussion_required", 403);
        return conversation;
    }

    private static async Task<object> Capture(Func<Task<object>> action)
    {
        try { return await action(); }
        catch (StoryException error) when (error.Status is 409 or 503)
        {
            return new { available = false, error = error.Code };
        }
    }
}
