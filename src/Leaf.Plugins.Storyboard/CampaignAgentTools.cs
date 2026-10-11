using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Leaf.Plugins.Storyboard;

public sealed class StoryCampaignAgentTools(
    StoryStore store,
    StoryCampaignAgent agent,
    StoryCampaignPlay play,
    StoryAgentPlaybooks playbooks,
    StoryMusic music,
    StoryVisuals visuals)
{
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
}
