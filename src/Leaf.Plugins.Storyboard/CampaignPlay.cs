using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Leaf.Sdk;
using Leaf.Sdk.Services;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Leaf.Plugins.Storyboard;

public sealed record CampaignPlayWrite(bool Enabled, string OperationId);
public sealed record CampaignPlaybookWrite(
    bool Enabled,
    bool AutoDrafts,
    int CooldownSeconds,
    string[]? Triggers,
    string Direction,
    string Avoid,
    long ExpectedRevision,
    string OperationId);

internal sealed record CampaignPlaybookSnapshot(JsonArray Items, string Hash);

public sealed class StoryAgentPlaybooks(StoryStore store, StoryCampaigns campaigns)
{
    public static readonly string[] Capabilities = ["planning", "information", "music", "visuals"];

    public async Task<object> ListAsync(string campaign, string account, CancellationToken ct = default)
    {
        await campaigns.MembershipAsync(campaign, account, true, ct);
        var snapshot = await SnapshotAsync(campaign, ct);
        return new { campaignId = campaign, revisionHash = snapshot.Hash, items = snapshot.Items };
    }

    public async Task<object> SaveAsync(
        string campaign,
        string account,
        string capability,
        CampaignPlaybookWrite input,
        CancellationToken ct = default)
    {
        capability = RequireCapability(capability);
        if (input is null) throw new StoryException("invalid_json");
        await campaigns.MembershipAsync(campaign, account, true, ct);
        await store.WritableAsync(ct);
        var operation = StoryJson.Id(input.OperationId).ToString();
        var direction = StoryJson.Bounded(input.Direction, 8_000);
        var avoid = StoryJson.Bounded(input.Avoid, 2_000);
        var triggers = NormalizeTriggers(input.Triggers);
        var payloadHash = StoryJson.Hash(new JsonObject
        {
            ["enabled"] = input.Enabled,
            ["autoDrafts"] = input.AutoDrafts,
            ["cooldownSeconds"] = Math.Clamp(input.CooldownSeconds, 15, 3_600),
            ["triggers"] = new JsonArray(triggers.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray()),
            ["direction"] = direction,
            ["avoid"] = avoid,
        }.ToJsonString());

        await store.Commands.WaitAsync(ct);
        try
        {
            var slug = Slug(campaign, capability);
            var existing = await store.Entities.GetBySlugAsync("storyboard-agent-playbook", slug, ct);
            if (existing is not null)
            {
                await store.CheckProtectionAsync(existing, ct);
                if (existing.Data.Text("campaign") != campaign || existing.Data.Text("capability") != capability)
                    throw new StoryException("not_found", 404);
                if (existing.Data.Text("last_operation") == operation)
                {
                    if (existing.Data.Text("last_payload_hash") != payloadHash)
                        throw new StoryException("idempotency_conflict", 409);
                    return Projection(existing);
                }
                if (existing.Data.Number("revision") != input.ExpectedRevision)
                    throw new StoryException("playbook_revision_conflict", 409);
            }
            else if (input.ExpectedRevision != 0)
            {
                throw new StoryException("playbook_revision_conflict", 409);
            }

            var campaignEntity = await store.RequireAsync("storyboard-campaign", campaign, ct);
            var protectedBase = await store.ProtectAsync(new JsonObject
            {
                ["campaign"] = campaign,
                ["capability"] = capability,
                ["parent"] = campaignEntity.Data.Text("workspace"),
            }, ct);
            var saved = await store.ChangeAsync("storyboard-agent-playbook", slug, Name(capability), old =>
            {
                var next = old?.Data.DeepClone().AsObject() ?? protectedBase.DeepClone().AsObject();
                next["enabled"] = input.Enabled;
                next["auto_drafts"] = input.AutoDrafts;
                next["cooldown_seconds"] = Math.Clamp(input.CooldownSeconds, 15, 3_600);
                next["triggers"] = new JsonArray(triggers.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());
                next["direction"] = direction;
                next["avoid"] = avoid;
                next["revision"] = next.Number("revision") + 1;
                next["last_operation"] = operation;
                next["last_payload_hash"] = payloadHash;
                next["updated_by"] = account;
                next["updated_at"] = DateTimeOffset.UtcNow.ToString("O");
                return next;
            }, ct);
            await store.AuditAsync("agent.playbook.saved", account, saved.Id.ToString(), new JsonObject
            {
                ["campaign"] = campaign,
                ["capability"] = capability,
                ["revision"] = saved.Data.Number("revision"),
                ["revision_hash"] = RevisionHash(saved),
            }, ct);
            return Projection(saved);
        }
        finally { store.Commands.Release(); }
    }

    internal async Task<CampaignPlaybookSnapshot> SnapshotAsync(string campaign, CancellationToken ct = default)
    {
        await store.RequireAsync("storyboard-campaign", campaign, ct);
        var stored = (await store.AllAsync("storyboard-agent-playbook", new Dictionary<string, object?> { ["campaign"] = campaign }, ct))
            .ToDictionary(value => value.Data.Text("capability"), StringComparer.OrdinalIgnoreCase);
        var items = new JsonArray();
        foreach (var capability in Capabilities)
        {
            items.Add(stored.TryGetValue(capability, out var entity)
                ? JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(Projection(entity), StoryJson.Options))
                : Default(capability));
        }
        var serialized = items.ToJsonString();
        return new CampaignPlaybookSnapshot(items, StoryJson.Hash(serialized));
    }

    internal async Task<JsonObject> RequireAutonomousDraftAsync(string campaign, string capability, CancellationToken ct)
    {
        var item = await RequireEnabledAsync(campaign, capability, ct);
        if (!item.Flag("enabled") || !item.Flag("autoDrafts"))
            throw new StoryException("agent_capability_disabled", 409);
        return item;
    }

    internal async Task<JsonObject> RequireEnabledAsync(string campaign, string capability, CancellationToken ct)
    {
        capability = RequireCapability(capability);
        var snapshot = await SnapshotAsync(campaign, ct);
        var item = snapshot.Items.OfType<JsonObject>().Single(value => value.Text("capability") == capability);
        if (!item.Flag("enabled")) throw new StoryException("agent_capability_disabled", 409);
        item["playbookHash"] = snapshot.Hash;
        return item;
    }

    private static object Projection(LeafEntity entity) => new
    {
        id = entity.Id,
        capability = entity.Data.Text("capability"),
        name = entity.Name,
        enabled = entity.Data.Flag("enabled"),
        autoDrafts = entity.Data.Flag("auto_drafts"),
        cooldownSeconds = entity.Data.Number("cooldown_seconds"),
        triggers = Strings(entity.Data["triggers"]),
        direction = entity.Data.Text("direction"),
        avoid = entity.Data.Text("avoid"),
        revision = entity.Data.Number("revision"),
        revisionHash = RevisionHash(entity),
        updatedAt = entity.Data.Text("updated_at", entity.UpdatedAt.ToString("O")),
    };

    private static JsonObject Default(string capability) => new()
    {
        ["id"] = null,
        ["capability"] = capability,
        ["name"] = Name(capability),
        ["enabled"] = true,
        ["autoDrafts"] = capability is "music" or "visuals",
        ["cooldownSeconds"] = capability is "music" or "visuals" ? 180 : 60,
        ["triggers"] = new JsonArray(DefaultTriggers(capability).Select(value => (JsonNode?)JsonValue.Create(value)).ToArray()),
        ["direction"] = "",
        ["avoid"] = "",
        ["revision"] = 0,
        ["revisionHash"] = StoryJson.Hash("default:" + capability),
        ["updatedAt"] = null,
    };

    private static string RequireCapability(string capability)
    {
        capability = StoryJson.Bounded(capability, 32, true).ToLowerInvariant();
        return Capabilities.Contains(capability, StringComparer.Ordinal) ? capability : throw new StoryException("invalid_agent_capability");
    }

    private static string[] NormalizeTriggers(string[]? values) => (values ?? [])
        .Select(value => StoryJson.Bounded(value, 48, true).ToLowerInvariant())
        .Distinct(StringComparer.Ordinal)
        .Take(12)
        .ToArray();

    private static string[] DefaultTriggers(string capability) => capability switch
    {
        "planning" => ["transcript-change", "discussion-change"],
        "information" => ["transcript-change", "session-ended"],
        "music" => ["scene-change", "mood-change", "queue-low"],
        "visuals" => ["scene-change", "location-change", "npc-reveal"],
        _ => ["gm-request"],
    };

    private static string[] Strings(JsonNode? node) => node is JsonArray array
        ? array.Select(value => value?.GetValue<string>() ?? "").Where(value => value != "").ToArray()
        : [];
    private static string Slug(string campaign, string capability) => $"agent-playbook-{campaign}-{capability}";
    private static string Name(string capability) => char.ToUpperInvariant(capability[0]) + capability[1..] + " direction";
    private static string RevisionHash(LeafEntity entity) => StoryJson.Hash(new JsonObject
    {
        ["capability"] = entity.Data.Text("capability"),
        ["enabled"] = entity.Data.Flag("enabled"),
        ["autoDrafts"] = entity.Data.Flag("auto_drafts"),
        ["cooldownSeconds"] = entity.Data.Number("cooldown_seconds"),
        ["triggers"] = entity.Data["triggers"]?.DeepClone(),
        ["direction"] = entity.Data.Text("direction"),
        ["avoid"] = entity.Data.Text("avoid"),
        ["revision"] = entity.Data.Number("revision"),
    }.ToJsonString());
}

public sealed class StoryCampaignPlay(
    StoryStore store,
    StoryCampaigns campaigns,
    StoryCampaignAgent agent,
    IWorkflowAutomations workflows,
    StoryChanges changes)
{
    public const string ActionType = "storyboard-campaign-heartbeat";

    public async Task<object> StatusAsync(string campaign, string account, CancellationToken ct = default)
    {
        await campaigns.MembershipAsync(campaign, account, true, ct);
        var status = await EntityAsync(campaign, ct);
        return Projection(campaign, status);
    }

    public async Task<object> SetAsync(string campaign, string account, CampaignPlayWrite input, CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_json");
        var operation = StoryJson.Id(input.OperationId).ToString();
        await campaigns.MembershipAsync(campaign, account, true, ct);
        await store.WritableAsync(ct);
        var conversation = await agent.EnsureHeartbeatAsync(campaign, ct);
        var config = await store.ConfigAsync(ct) ?? throw new StoryException("storyboard_not_configured", 503);
        var definition = Definition(conversation, config, input.Enabled);
        var automation = await workflows.UpsertAsync(definition, ct);
        var campaignEntity = conversation.Campaign;
        var protectedBase = await store.ProtectAsync(new JsonObject
        {
            ["campaign"] = campaign,
            ["parent"] = campaignEntity.Data.Text("workspace"),
            ["revision"] = 0,
        }, ct);
        var status = await store.ChangeAsync("storyboard-play-mode", "play-mode-" + campaign, "Play mode", old =>
        {
            var next = old?.Data.DeepClone().AsObject() ?? protectedBase.DeepClone().AsObject();
            if (next.Text("last_operation") == operation && next.Flag("enabled") != input.Enabled)
                throw new StoryException("idempotency_conflict", 409);
            if (next.Text("last_operation") == operation) return next;
            next["enabled"] = input.Enabled;
            next["automation"] = automation.Id.ToString();
            next["heartbeat_discussion"] = conversation.Discussion.Data.Text("discussion_id");
            next["heartbeat_session"] = conversation.Handle.SessionId;
            next["revision"] = next.Number("revision") + 1;
            next["last_operation"] = operation;
            next["updated_by"] = account;
            next["updated_at"] = DateTimeOffset.UtcNow.ToString("O");
            if (input.Enabled) next["started_at"] = DateTimeOffset.UtcNow.ToString("O");
            else next["ended_at"] = DateTimeOffset.UtcNow.ToString("O");
            return next;
        }, ct);
        await store.AuditAsync(input.Enabled ? "play-mode.started" : "play-mode.ended", account, status.Id.ToString(), new JsonObject
        {
            ["campaign"] = campaign,
            ["automation"] = automation.Id.ToString(),
            ["heartbeat_discussion"] = conversation.Discussion.Data.Text("discussion_id"),
        }, ct);
        changes.Bump(campaign, "play-mode");
        return Projection(campaign, status);
    }

    internal async Task<LeafEntity?> EntityAsync(string campaign, CancellationToken ct = default)
    {
        var value = await store.Entities.GetBySlugAsync("storyboard-play-mode", "play-mode-" + campaign, ct);
        if (value is null) return null;
        await store.CheckProtectionAsync(value, ct);
        return value.Data.Text("campaign") == campaign ? value : null;
    }

    internal async Task<LeafEntity> RequireActiveAsync(string campaign, Guid automation, CancellationToken ct)
    {
        var status = await EntityAsync(campaign, ct) ?? throw new StoryException("play_mode_inactive", 409);
        if (!status.Data.Flag("enabled") || status.Data.Text("automation") != automation.ToString())
            throw new StoryException("play_mode_inactive", 409);
        return status;
    }

    internal async Task ReconcileAsync(CancellationToken ct)
    {
        foreach (var status in await store.AllAsync("storyboard-play-mode", new Dictionary<string, object?> { ["enabled"] = true }, ct))
        {
            var conversation = await agent.EnsureHeartbeatAsync(status.Data.Text("campaign"), ct);
            var config = await store.ConfigAsync(ct) ?? throw new StoryException("storyboard_not_configured", 503);
            var automation = await workflows.UpsertAsync(Definition(conversation, config, true), ct);
            if (status.Data.Text("automation") != automation.Id.ToString())
            {
                await store.ChangeAsync(status.TypeSlug, status.Slug, status.Name, old =>
                {
                    var next = old!.Data.DeepClone().AsObject();
                    next["automation"] = automation.Id.ToString();
                    next["heartbeat_discussion"] = conversation.Discussion.Data.Text("discussion_id");
                    next["heartbeat_session"] = conversation.Handle.SessionId;
                    return next;
                }, ct);
                changes.Bump(status.Data.Text("campaign"), "play-mode");
            }
        }
    }

    private static object Projection(string campaign, LeafEntity? status) => new
    {
        campaignId = campaign,
        enabled = status?.Data.Flag("enabled") == true,
        revision = status?.Data.Number("revision") ?? 0,
        heartbeatDiscussionId = status?.Data.Text("heartbeat_discussion") ?? "",
        automationId = status?.Data.Text("automation") ?? "",
        startedAt = status?.Data.Text("started_at") ?? "",
        updatedAt = status?.Data.Text("updated_at") ?? "",
    };

    private static WorkflowAutomationDefinition Definition(CampaignConversation conversation, LeafEntity config, bool enabled)
    {
        var campaign = conversation.Campaign.Id.ToString();
        return new WorkflowAutomationDefinition
        {
            Slug = "storyboard-heartbeat-" + conversation.Campaign.Id.ToString("N"),
            Name = "Storyboard heartbeat: " + conversation.Campaign.Name,
            NodeType = ActionType,
            Enabled = enabled,
            Trigger = new JsonObject
            {
                ["kind"] = "cron",
                ["expression"] = "*/2 * * * *",
                ["timezone"] = "Europe/Zurich",
                ["misfire_policy"] = "skip",
                ["grace_seconds"] = 60,
            },
            ActionConfig = new JsonObject
            {
                ["campaign"] = campaign,
                ["tick_wait_minutes"] = 10,
            },
            NodeContext = new JsonObject { ["campaign"] = campaign },
            ExecutionPolicy = new JsonObject
            {
                ["overlap"] = "forbid",
                ["timeout_seconds"] = 720,
                ["lease_seconds"] = 180,
                ["max_failures"] = 20,
                ["retry_count"] = 0,
                ["retry_delay_seconds"] = 15,
                ["recovery"] = "at-least-once",
                ["recovery_reason"] = "A crash after durable campaign-heartbeat admission may redeliver the same idempotency key",
            },
            Ownership = new JsonObject
            {
                ["app"] = "storyboard",
                ["actor_agent"] = conversation.Agent.Id.ToString(),
                ["user_id"] = config.Data.Text("owner_id"),
                ["beneficiary"] = new JsonObject
                {
                    ["kind"] = "user",
                    ["id"] = config.Data.Text("owner_id"),
                    ["authored"] = true,
                    ["authored_by"] = "storyboard-play-mode",
                    ["authored_at"] = DateTimeOffset.UtcNow,
                },
            },
            Metadata = new JsonObject
            {
                ["campaign"] = campaign,
                ["agent"] = conversation.Agent.Id.ToString(),
                ["heartbeat_discussion"] = conversation.Discussion.Data.Text("discussion_id"),
            },
            Description = "Runs the campaign Agent only while Storyboard play mode is active.",
            ReviewReason = "Storyboard campaign heartbeat authored by the installed plugin",
            Confidential = true,
        };
    }
}

public sealed class StoryCampaignHeartbeatHandler(
    StoryCampaignPlay play,
    StoryAgentPlaybooks playbooks,
    StoryCampaignAgent agent) : IAutomationActionHandler
{
    public string ActionType => StoryCampaignPlay.ActionType;

    public async Task<JsonObject?> ExecuteAsync(AutomationActionContext context, CancellationToken ct)
    {
        var campaign = context.ActionConfig?.Text("campaign") ?? "";
        if (!Guid.TryParse(campaign, out _)) throw new InvalidOperationException("Storyboard heartbeat has no campaign");
        try { await play.RequireActiveAsync(campaign, context.Automation.Id, ct); }
        catch (StoryException error) when (error.Code == "play_mode_inactive")
        {
            return new JsonObject { ["summary"] = "skipped: play mode is inactive", ["skipped"] = true, ["silent"] = true };
        }
        var snapshot = await playbooks.SnapshotAsync(campaign, ct);
        return await agent.RunHeartbeatAsync(campaign, context.AttemptJobId, context.CorrelationId, snapshot, ct);
    }
}

public sealed class StoryCampaignHeartbeatWake(
    StoryCampaignPlay play,
    IAutomationRunner runner,
    ILogger<StoryCampaignHeartbeatWake> logger) : BackgroundService
{
    private sealed record Wake(string Campaign, string Reason, string Key, DateTimeOffset At);
    private readonly Channel<Wake> queue = Channel.CreateUnbounded<Wake>(new UnboundedChannelOptions { SingleReader = true });
    private readonly ConcurrentDictionary<string, Wake> pending = new(StringComparer.Ordinal);

    public void Signal(string campaign, string reason, string operation)
    {
        if (!Guid.TryParse(campaign, out _)) return;
        var wake = new Wake(campaign, StoryJson.Bounded(reason, 80, true), StoryJson.Bounded(operation, 160, true), DateTimeOffset.UtcNow);
        pending[campaign] = wake;
        queue.Writer.TryWrite(wake);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await play.ReconcileAsync(stoppingToken); }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
        catch (Exception error) { logger.LogWarning(error, "Storyboard play-mode reconciliation failed"); }

        await foreach (var wake in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
                if (!pending.TryGetValue(wake.Campaign, out var current) || current != wake) continue;
                pending.TryRemove(wake.Campaign, out _);
                var state = await play.EntityAsync(wake.Campaign, stoppingToken);
                if (state?.Data.Flag("enabled") != true || !Guid.TryParse(state.Data.Text("automation"), out var automation)) continue;
                await runner.TriggerAsync(automation, "storyboard-wake:" + StoryJson.Hash(wake.Campaign + ":" + wake.Key), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception error) { logger.LogWarning(error, "Storyboard campaign heartbeat wake failed for {Campaign}", wake.Campaign); }
        }
    }
}
