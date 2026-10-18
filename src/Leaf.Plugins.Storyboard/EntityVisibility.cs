using System.Text.Json.Nodes;
using Leaf.Sdk;
using Leaf.Sdk.Services;

namespace Leaf.Plugins.Storyboard;

public sealed record EntityVisibilityWrite(bool Everyone, string[]? PlayerIds, bool Visible, string OperationId);

public sealed class StoryEntityVisibility(
    StoryStore store,
    StoryCampaigns campaigns,
    StoryWorkspace workspace,
    IAssets assets,
    StoryChanges changes,
    StorySessionLedger ledger)
{
    private const string OperationStream = "entity-visibility-operations";
    public Task<object> SetAsync(string campaign, string account, string entityId, EntityVisibilityWrite input, CancellationToken ct = default)
        => SetCoreAsync(campaign, account, account, true, entityId, input, ct);

    internal Task<object> AgentSetAsync(string campaign, string agentId, string entityId, EntityVisibilityWrite input, CancellationToken ct = default)
        => SetCoreAsync(campaign, "", agentId, false, entityId, input, ct);

    public async Task MigrateAsync(CancellationToken ct = default)
    {
        if (await store.ConfigAsync(ct) is null) return;
        await store.Commands.WaitAsync(ct);
        try
        {
            var legacy = (await store.AllAsync("storyboard-entity-visibility", ct: ct))
                .Where(value => value.Data.Text("player") == "")
                .OrderBy(value => value.CreatedAt)
                .ToArray();
            foreach (var old in legacy)
            {
                var campaign = old.Data.Text("campaign");
                var entity = old.Data.Text("entity");
                var activePlayers = await ActivePlayersAsync(campaign, ct);
                var selected = old.Data.Text("audience") == "all"
                    ? activePlayers.Select(value => value.Id.ToString()).ToArray()
                    : Strings(old.Data["players"]);
                var valid = activePlayers.Select(value => value.Id.ToString()).ToHashSet(StringComparer.Ordinal);
                foreach (var player in selected.Where(valid.Contains).Distinct(StringComparer.Ordinal))
                {
                    var seed = await store.ProtectAsync(new JsonObject
                    {
                        ["campaign"] = campaign,
                        ["entity"] = entity,
                        ["player"] = player,
                        ["parent"] = old.Data.Text("parent"),
                        ["active"] = old.Data.Flag("active"),
                        ["entity_updated_at"] = old.Data.Text("entity_updated_at"),
                        ["revision"] = Math.Max(1, old.Data.Number("revision")),
                        ["revealed_at"] = old.Data.Text("revealed_at", old.CreatedAt.ToString("O")),
                        ["revealed_by"] = old.Data.Text("updated_by"),
                        ["updated_by"] = old.Data.Text("updated_by"),
                        ["updated_at"] = old.Data.Text("updated_at", old.UpdatedAt.ToString("O")),
                        ["operation_id"] = old.Data.Text("last_operation"),
                    }, ct);
                    await store.ChangeAsync("storyboard-entity-visibility", Slug(campaign, entity, player), old.Name,
                        current => current?.Data.DeepClone().AsObject() ?? seed.DeepClone().AsObject(), ct);
                }
                await store.Entities.DeleteAsync(old.Id, ct);
                changes.Bump(campaign, ["cockpit", .. selected.Where(valid.Contains).Distinct(StringComparer.Ordinal).Select(player => "journal:" + player)]);
                var migratedPlayers = selected.Where(valid.Contains).Distinct(StringComparer.Ordinal).ToArray();
                if (migratedPlayers.Length > 0) await ledger.AppendAsync(campaign, old.Id.ToString(), old.Data.Flag("active") ? "entity-revealed" : "entity-hidden", "system", "storyboard-migration", $"{old.Name} visibility migrated", new JsonObject { ["entity"] = entity, ["players"] = new JsonArray(migratedPlayers.Select(value => (JsonNode?)value).ToArray()), ["visible"] = old.Data.Flag("active"), ["migration"] = true }, ct);
            }
        }
        finally { store.Commands.Release(); }
    }

    private async Task<object> SetCoreAsync(string campaign, string account, string auditActor, bool requireGm, string entityId, EntityVisibilityWrite input, CancellationToken ct)
    {
        if (input is null) throw new StoryException("invalid_json");
        var operation = StoryJson.Id(input.OperationId).ToString();
        if (requireGm) await campaigns.MembershipAsync(campaign, account, true, ct);
        await MigrateAsync(ct);
        var playerContext = await workspace.PlayerContextAsync(campaign, entityId, ct);
        var players = await ActivePlayersAsync(campaign, ct);
        var valid = players.Select(value => value.Id.ToString()).ToHashSet(StringComparer.Ordinal);
        var selected = (input.PlayerIds ?? [])
            .Select(value => StoryJson.Id(value).ToString())
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        if (!input.Everyone && selected.Length == 0) throw new StoryException("visibility_audience_required");
        if (selected.Any(value => !valid.Contains(value))) throw new StoryException("visibility_player_invalid");

        var payload = new JsonObject
        {
            ["campaign"] = campaign,
            ["entity"] = playerContext.Entity.Id.ToString(),
            ["visible"] = input.Visible,
            ["everyone"] = input.Everyone,
            ["players"] = new JsonArray(selected.Select(value => (JsonNode?)value).ToArray()),
        };
        var priorOperation = (await store.Records.QueryAsync(OperationStream, new RecordQuery { ExternalId = operation, Limit = 1 }, ct)).SingleOrDefault();
        if (priorOperation is not null)
        {
            if (!JsonNode.DeepEquals(priorOperation.Data, payload)) throw new StoryException("idempotency_conflict", 409);
            return await AggregateAsync(campaign, playerContext.Entity.Id.ToString(), players, ct);
        }

        var changedPlayers = new List<string>();
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            if (requireGm) await campaigns.MembershipAsync(campaign, account, true, ct);
            var records = await RecordsAsync(campaign, playerContext.Entity.Id.ToString(), ct);
            var targets = input.Everyone
                ? input.Visible
                    ? players.Select(value => value.Id.ToString()).ToArray()
                    : records.Select(value => value.Data.Text("player")).Where(value => value != "").Distinct(StringComparer.Ordinal).ToArray()
                : selected;
            var campaignEntity = await store.RequireAsync("storyboard-campaign", campaign, ct);
            var changedAt = DateTimeOffset.UtcNow.ToString("O");
            var changed = 0;
            foreach (var player in targets)
            {
                var slug = Slug(campaign, playerContext.Entity.Id.ToString(), player);
                var existing = records.SingleOrDefault(value => value.Data.Text("player") == player)
                               ?? await store.Entities.GetBySlugAsync("storyboard-entity-visibility", slug, ct);
                if (existing is not null)
                {
                    await store.CheckProtectionAsync(existing, ct);
                    if (existing.Data.Text("campaign") != campaign || existing.Data.Text("entity") != playerContext.Entity.Id.ToString() || existing.Data.Text("player") != player) throw new StoryException("not_found", 404);
                    if (existing.Data.Flag("active") == input.Visible) continue;
                }
                var seed = await store.ProtectAsync(new JsonObject
                {
                    ["campaign"] = campaign,
                    ["entity"] = playerContext.Entity.Id.ToString(),
                    ["player"] = player,
                    ["parent"] = campaignEntity.Data.Text("workspace"),
                    ["revision"] = 0,
                }, ct);
                await store.ChangeAsync("storyboard-entity-visibility", slug, playerContext.Entity.Name, old =>
                {
                    var next = old?.Data.DeepClone().AsObject() ?? seed.DeepClone().AsObject();
                    var wasActive = old?.Data.Flag("active") == true;
                    next["active"] = input.Visible;
                    next["entity_updated_at"] = playerContext.Entity.UpdatedAt.ToString("O");
                    next["revision"] = next.Number("revision") + 1;
                    next["updated_by"] = auditActor;
                    next["updated_at"] = changedAt;
                    next["operation_id"] = operation;
                    if (input.Visible && !wasActive)
                    {
                        next["revealed_at"] = changedAt;
                        next["revealed_by"] = auditActor;
                    }
                    return next;
                }, ct);
                changed++;
                changedPlayers.Add(player);
            }
            await store.Records.AppendOnceAsync(OperationStream, operation, payload, playerContext.Entity.Id, auditActor, ct);
            if (changed > 0) await store.AuditAsync(input.Visible ? "workspace.entity.revealed" : "workspace.entity.hidden", auditActor, playerContext.Entity.Id.ToString(), new JsonObject
            {
                ["campaign"] = campaign,
                ["entity"] = playerContext.Entity.Id.ToString(),
                ["player_count"] = targets.Length,
                ["agent_generated"] = !requireGm,
            }, ct);
        }
        finally { store.Commands.Release(); }
        if (changedPlayers.Count > 0)
        {
            changes.Bump(campaign, ["cockpit", .. changedPlayers.Select(player => "journal:" + player)]);
            await ledger.AppendAsync(campaign, operation, input.Visible ? "entity-revealed" : "entity-hidden", requireGm ? "gm" : "agent", auditActor, $"{playerContext.Entity.Name} {(input.Visible ? "revealed" : "hidden")}", new JsonObject { ["entity"] = playerContext.Entity.Id.ToString(), ["players"] = new JsonArray(changedPlayers.Select(value => (JsonNode?)value).ToArray()), ["visible"] = input.Visible }, ct);
        }
        return await AggregateAsync(campaign, playerContext.Entity.Id.ToString(), players, ct);
    }

    public async Task<object> JournalAsync(string campaign, string account, CancellationToken ct = default)
    {
        var membership = await campaigns.MembershipAsync(campaign, account, ct: ct);
        await MigrateAsync(ct);
        var gm = membership.Data.Text("role") == "gm";
        var grants = (await store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign, ["active"] = true }, ct))
            .Where(value => gm || value.Data.Text("player") == membership.Id.ToString())
            .GroupBy(value => value.Data.Text("entity"), StringComparer.Ordinal)
            .Select(group => group.OrderByDescending(value => value.Data.Text("revealed_at", value.UpdatedAt.ToString("O")), StringComparer.Ordinal).First())
            .OrderByDescending(value => value.Data.Text("revealed_at", value.UpdatedAt.ToString("O")), StringComparer.Ordinal)
            .ToArray();
        var items = new JsonArray();
        foreach (var grant in grants)
        {
            try
            {
                var context = await workspace.PlayerContextAsync(campaign, grant.Data.Text("entity"), ct);
                var item = context.Projection.DeepClone().AsObject();
                item["revealedAt"] = grant.Data.Text("revealed_at", grant.UpdatedAt.ToString("O"));
                items.Add(item);
            }
            catch (StoryException error) when (error.Code is "not_found" or "player_view_required") { }
        }
        return new
        {
            items,
            latestRevealAt = grants.FirstOrDefault()?.Data.Text("revealed_at", grants.FirstOrDefault()?.UpdatedAt.ToString("O") ?? "") ?? "",
        };
    }

    public async Task<object> IndexAsync(string campaign, string account, CancellationToken ct = default)
    {
        await campaigns.MembershipAsync(campaign, account, true, ct);
        await MigrateAsync(ct);
        var players = await ActivePlayersAsync(campaign, ct);
        var records = await store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign }, ct);
        return new
        {
            items = records.GroupBy(value => value.Data.Text("entity"), StringComparer.Ordinal)
                .Select(group => Aggregate(group.Key, group.ToArray(), players))
                .OrderByDescending(value => value.UpdatedAt, StringComparer.Ordinal)
                .ToArray(),
        };
    }

    internal async Task<IReadOnlyDictionary<string, JsonObject>> StateAsync(string campaign, CancellationToken ct = default)
    {
        await MigrateAsync(ct);
        var players = await ActivePlayersAsync(campaign, ct);
        return (await store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign }, ct))
            .GroupBy(value => value.Data.Text("entity"), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => StoryJson.Object(Aggregate(group.Key, group.ToArray(), players)), StringComparer.Ordinal);
    }

    public async Task<(byte[] Bytes, string ContentType)?> ImageAsync(string campaign, string account, string entityId, CancellationToken ct = default)
    {
        var membership = await campaigns.MembershipAsync(campaign, account, ct: ct);
        await MigrateAsync(ct);
        if (membership.Data.Text("role") != "gm")
        {
            var grant = await store.Entities.GetBySlugAsync("storyboard-entity-visibility", Slug(campaign, StoryJson.Id(entityId).ToString(), membership.Id.ToString()), ct);
            if (grant is null || !grant.Data.Flag("active") || grant.Data.Text("campaign") != campaign) throw new StoryException("not_found", 404);
        }
        var context = await workspace.PlayerContextAsync(campaign, entityId, ct);
        if (context.ImageAssetId == "") return null;
        var legacy = System.Text.RegularExpressions.Regex.Match(context.ImageAssetId, @"^/api/campaigns/[0-9a-f-]{36}/visuals/candidates/(?<id>[0-9a-f-]{36})/image$", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        if (legacy.Success)
        {
            await workspace.RequireCampaignAssetAsync(campaign, context.ImageAssetId, ct);
            var candidate = await store.RequireAsync("storyboard-visual-candidate", legacy.Groups["id"].Value, ct);
            var legacyFile = await assets.ReadAsync(candidate.Data.Text("image_asset"), ct);
            return legacyFile is null ? null : (legacyFile.Bytes, legacyFile.ContentType);
        }
        await workspace.RequireCampaignAssetAsync(campaign, context.ImageAssetId, ct);
        var file = await assets.ReadAsync(context.ImageAssetId, ct);
        return file is null ? null : (file.Bytes, file.ContentType);
    }

    private async Task<IReadOnlyList<LeafEntity>> ActivePlayersAsync(string campaign, CancellationToken ct)
        => (await store.AllAsync("storyboard-player", new Dictionary<string, object?> { ["campaign"] = campaign, ["active"] = true }, ct))
            .Where(value => value.Data.Text("role") == "player").ToArray();

    private Task<List<LeafEntity>> RecordsAsync(string campaign, string entity, CancellationToken ct)
        => store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign, ["entity"] = entity }, ct);

    private async Task<VisibilityProjection> AggregateAsync(string campaign, string entity, IReadOnlyList<LeafEntity> players, CancellationToken ct)
        => Aggregate(entity, await RecordsAsync(campaign, entity, ct), players);

    private static VisibilityProjection Aggregate(string entity, IReadOnlyList<LeafEntity> records, IReadOnlyList<LeafEntity> activePlayers)
    {
        var active = records.Where(value => value.Data.Flag("active")).OrderBy(value => value.Data.Text("player"), StringComparer.Ordinal).ToArray();
        var playerIds = active.Select(value => value.Data.Text("player")).Where(value => value != "").Distinct(StringComparer.Ordinal).ToArray();
        var current = activePlayers.Select(value => value.Id.ToString()).OrderBy(value => value, StringComparer.Ordinal).ToArray();
        var latest = records.OrderByDescending(value => value.Data.Text("updated_at", value.UpdatedAt.ToString("O")), StringComparer.Ordinal).FirstOrDefault();
        var revealed = active.Select(value => value.Data.Text("revealed_at")).Where(value => value != "").OrderByDescending(value => value, StringComparer.Ordinal).FirstOrDefault() ?? "";
        return new VisibilityProjection(
            latest?.Id ?? Guid.Empty,
            entity,
            active.Length > 0,
            playerIds.Length > 0 && playerIds.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(current, StringComparer.Ordinal) ? "all" : "selected",
            playerIds,
            records.Count == 0 ? 0 : records.Max(value => value.Data.Number("revision")),
            revealed,
            latest?.Data.Text("updated_at", latest.UpdatedAt.ToString("O")) ?? "");
    }

    private static string Slug(string campaign, string entity, string player) => "entity-visibility-" + StoryJson.Hash(campaign + "|" + entity + "|" + player);
    private static string[] Strings(JsonNode? node) => node is JsonArray values ? values.Select(value => value?.GetValue<string>() ?? "").Where(value => value != "").ToArray() : [];
    private sealed record VisibilityProjection(Guid Id, string EntityId, bool Active, string Audience, string[] PlayerIds, long Revision, string RevealedAt, string UpdatedAt);
}
