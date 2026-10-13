using System.Text.Json.Nodes;
using Leaf.Sdk;
using Leaf.Sdk.Services;

namespace Leaf.Plugins.Storyboard;

public sealed record EntityVisibilityWrite(bool Everyone, string[]? PlayerIds, bool Visible, string OperationId);

public sealed class StoryEntityVisibility(
    StoryStore store,
    StoryCampaigns campaigns,
    StoryWorkspace workspace,
    StoryVisuals visuals,
    IAssets assets)
{
    public Task<object> SetAsync(string campaign, string account, string entityId, EntityVisibilityWrite input, CancellationToken ct = default)
        => SetCoreAsync(campaign, account, account, true, entityId, input, ct);

    internal Task<object> AgentSetAsync(string campaign, string agentId, string entityId, EntityVisibilityWrite input, CancellationToken ct = default)
        => SetCoreAsync(campaign, "", agentId, false, entityId, input, ct);

    private async Task<object> SetCoreAsync(string campaign, string account, string auditActor, bool requireGm, string entityId, EntityVisibilityWrite input, CancellationToken ct)
    {
        if (input is null) throw new StoryException("invalid_json");
        var operation = StoryJson.Id(input.OperationId).ToString();
        if (requireGm) await campaigns.MembershipAsync(campaign, account, true, ct);
        var playerContext = await workspace.PlayerContextAsync(campaign, entityId, ct);
        var players = (await store.AllAsync("storyboard-player", new Dictionary<string, object?> { ["campaign"] = campaign, ["active"] = true }, ct))
            .Where(value => value.Data.Text("role") == "player")
            .ToArray();
        var valid = players.Select(value => value.Id.ToString()).ToHashSet(StringComparer.Ordinal);
        var selected = (input.PlayerIds ?? [])
            .Select(value => StoryJson.Id(value).ToString())
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        if (!input.Everyone && input.Visible && selected.Length == 0) throw new StoryException("visibility_audience_required");
        if (selected.Any(value => !valid.Contains(value))) throw new StoryException("visibility_player_invalid");
        var audience = input.Everyone ? "all" : "selected";
        var payloadHash = StoryJson.Hash(new JsonObject
        {
            ["active"] = input.Visible,
            ["audience"] = audience,
            ["players"] = new JsonArray(selected.Select(value => (JsonNode?)value).ToArray()),
        }.ToJsonString());

        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            if (requireGm) await campaigns.MembershipAsync(campaign, account, true, ct);
            var slug = "entity-visibility-" + StoryJson.Hash(campaign + "|" + playerContext.Entity.Id);
            var existing = await store.Entities.GetBySlugAsync("storyboard-entity-visibility", slug, ct);
            if (existing is not null)
            {
                await store.CheckProtectionAsync(existing, ct);
                if (existing.Data.Text("campaign") != campaign || existing.Data.Text("entity") != playerContext.Entity.Id.ToString()) throw new StoryException("not_found", 404);
                if (existing.Data.Text("last_operation") == operation)
                {
                    if (existing.Data.Text("last_payload_hash") != payloadHash) throw new StoryException("idempotency_conflict", 409);
                    return Projection(existing);
                }
            }
            var campaignEntity = await store.RequireAsync("storyboard-campaign", campaign, ct);
            var seed = await store.ProtectAsync(new JsonObject
            {
                ["campaign"] = campaign,
                ["entity"] = playerContext.Entity.Id.ToString(),
                ["parent"] = campaignEntity.Data.Text("workspace"),
                ["revision"] = 0,
            }, ct);
            var changedAt = DateTimeOffset.UtcNow.ToString("O");
            var saved = await store.ChangeAsync("storyboard-entity-visibility", slug, playerContext.Entity.Name, old =>
            {
                var next = old?.Data.DeepClone().AsObject() ?? seed.DeepClone().AsObject();
                next["active"] = input.Visible;
                next["audience"] = audience;
                next["players"] = new JsonArray(selected.Select(value => (JsonNode?)value).ToArray());
                next["entity_updated_at"] = playerContext.Entity.UpdatedAt.ToString("O");
                next["revision"] = next.Number("revision") + 1;
                next["updated_by"] = auditActor;
                next["updated_at"] = changedAt;
                if (input.Visible) next["revealed_at"] = changedAt;
                next["last_operation"] = operation;
                next["last_payload_hash"] = payloadHash;
                return next;
            }, ct);
            await store.AuditAsync(input.Visible ? "workspace.entity.revealed" : "workspace.entity.hidden", auditActor, saved.Id.ToString(), new JsonObject
            {
                ["campaign"] = campaign,
                ["entity"] = playerContext.Entity.Id.ToString(),
                ["audience"] = audience,
                ["player_count"] = input.Everyone ? players.Length : selected.Length,
                ["agent_generated"] = !requireGm,
            }, ct);
            return Projection(saved);
        }
        finally { store.Commands.Release(); }
    }

    public async Task<object> JournalAsync(string campaign, string account, CancellationToken ct = default)
    {
        var membership = await campaigns.MembershipAsync(campaign, account, ct: ct);
        var gm = membership.Data.Text("role") == "gm";
        var grants = (await store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign, ["active"] = true }, ct))
            .Where(value => gm || Allows(value, membership.Id.ToString()))
            .OrderByDescending(value => value.Data.Text("revealed_at", value.UpdatedAt.ToString("O")))
            .ToArray();
        var items = new JsonArray();
        foreach (var grant in grants)
        {
            try
            {
                var context = await workspace.PlayerContextAsync(campaign, grant.Data.Text("entity"), ct);
                var item = context.Projection.DeepClone().AsObject();
                item["revealedAt"] = grant.Data.Text("revealed_at", grant.UpdatedAt.ToString("O"));
                item["visibility"] = ProjectionNode(grant);
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
        return new
        {
            items = (await store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign }, ct))
                .OrderByDescending(value => value.UpdatedAt)
                .Select(Projection)
                .ToArray(),
        };
    }

    internal async Task<IReadOnlyDictionary<string, JsonObject>> StateAsync(string campaign, CancellationToken ct = default)
        => (await store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign }, ct))
            .GroupBy(value => value.Data.Text("entity"), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => ProjectionNode(group.OrderByDescending(value => value.UpdatedAt).First()), StringComparer.Ordinal);

    public async Task<(byte[] Bytes, string ContentType)?> ImageAsync(string campaign, string account, string entityId, CancellationToken ct = default)
    {
        var membership = await campaigns.MembershipAsync(campaign, account, ct: ct);
        if (membership.Data.Text("role") != "gm")
        {
            var grant = await store.Entities.GetBySlugAsync("storyboard-entity-visibility", "entity-visibility-" + StoryJson.Hash(campaign + "|" + StoryJson.Id(entityId)), ct);
            if (grant is null || !grant.Data.Flag("active") || grant.Data.Text("campaign") != campaign || !Allows(grant, membership.Id.ToString())) throw new StoryException("not_found", 404);
        }
        var context = await workspace.PlayerContextAsync(campaign, entityId, ct);
        if (context.ImageAssetId == "") return null;
        var legacy = System.Text.RegularExpressions.Regex.Match(context.ImageAssetId, @"^/api/campaigns/[0-9a-f-]{36}/visuals/candidates/(?<id>[0-9a-f-]{36})/image$", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        if (legacy.Success) return await visuals.CandidateMediaAsync(campaign, account, legacy.Groups["id"].Value, ct);
        var file = await assets.ReadAsync(context.ImageAssetId, ct);
        return file is null ? null : (file.Bytes, file.ContentType);
    }

    private static bool Allows(LeafEntity grant, string membership)
        => grant.Data.Text("audience") == "all" || Strings(grant.Data["players"]).Contains(membership, StringComparer.Ordinal);

    private static object Projection(LeafEntity value) => new
    {
        id = value.Id,
        entityId = value.Data.Text("entity"),
        active = value.Data.Flag("active"),
        audience = value.Data.Text("audience", "selected"),
        playerIds = Strings(value.Data["players"]),
        revision = value.Data.Number("revision"),
        revealedAt = value.Data.Text("revealed_at"),
        updatedAt = value.Data.Text("updated_at", value.UpdatedAt.ToString("O")),
    };

    private static JsonObject ProjectionNode(LeafEntity value) => JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(Projection(value), StoryJson.Options))!.AsObject();
    private static string[] Strings(JsonNode? node) => node is JsonArray values ? values.Select(value => value?.GetValue<string>() ?? "").Where(value => value != "").ToArray() : [];
}
