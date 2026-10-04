using Leaf.Sdk;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Leaf.Plugins.Storyboard;

public sealed record WorkspaceEntityWrite(string Name, JsonObject Data, string ExpectedUpdatedAt);
public sealed record WorkspaceEntityCreate(string TypeSlug, string Name, string? Parent, JsonObject? Data);
public sealed record WorkspaceEntityDelete(string ExpectedUpdatedAt);

public sealed class StoryWorkspace(StoryStore store, StoryCampaigns campaigns)
{
    private static readonly HashSet<string> SystemTypes = new(StringComparer.Ordinal)
    {
        "storyboard-campaign", "storyboard-player", "storyboard-character", "storyboard-generation",
        "storyboard-music-playlist", "storyboard-music-playlist-item", "storyboard-music-generation",
        "storyboard-music-candidate", "storyboard-music-queue-item", "storyboard-visual-profile",
        "storyboard-visual", "storyboard-visual-set", "storyboard-visual-set-item",
        "storyboard-visual-generation", "storyboard-visual-candidate", "storyboard-visual-queue-item",
        "storyboard-visual-session"
    };
    private static readonly string[] ProtectedKeys = ["owner_id", "owner_agent_id", "owner_plugin", "installation", "confidential", "parent"];

    public async Task<object> SnapshotAsync(string campaign, string account, CancellationToken ct = default)
    {
        var context = await ContextAsync(campaign, account, ct);
        return new
        {
            root = Project(context.Root, null),
            entities = context.Entities.OrderBy(e => e.TypeSlug == "page" ? 0 : 1).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).Select(e => Project(e, context.Types.GetValueOrDefault(e.TypeSlug))),
            types = context.Types.Values.OrderBy(t => t.System).ThenBy(t => t.Folder).ThenBy(t => t.Name).Select(t => new
            {
                slug = t.Slug, name = t.Name, description = t.Description, icon = t.Icon, color = t.Color,
                folder = t.Folder, system = t.System,
                fields = t.Fields.Select(f => new { key = f.Key, name = f.Name, fieldType = f.FieldType, sortOrder = f.SortOrder, required = f.Required, description = f.Description, constraints = f.Constraints, displayHints = f.DisplayHints })
            })
        };
    }

    public async Task<object> SaveAsync(string campaign, string account, string entityId, WorkspaceEntityWrite input, CancellationToken ct = default)
    {
        if (input is null || input.Data is null || !DateTimeOffset.TryParse(input.ExpectedUpdatedAt, out var expected)) throw new StoryException("invalid_workspace_write");
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            var context = await ContextAsync(campaign, account, ct);
            var entity = context.Entities.SingleOrDefault(e => e.Id == StoryJson.Id(entityId)) ?? throw new StoryException("not_found", 404);
            var type = context.Types.GetValueOrDefault(entity.TypeSlug) ?? throw new StoryException("workspace_type_unavailable", 409);
            if (type.System || entity.TypeSlug == "page") throw new StoryException("workspace_entity_read_only", 409);
            var next = entity.Data.DeepClone().AsObject();
            foreach (var field in type.Fields.Where(f => !f.Sensitive))
                if (input.Data.TryGetPropertyValue(field.Key, out var value)) next[field.Key] = value?.DeepClone();
            foreach (var key in ProtectedKeys) if (entity.Data.TryGetPropertyValue(key, out var value)) next[key] = value?.DeepClone(); else next.Remove(key);
            LeafEntity? saved;
            try { saved = await store.Entities.CompareExchangeCanonicalAsync(entity.Id, StoryJson.Bounded(input.Name, 300, true), next, expected, ct); }
            catch (InvalidOperationException) { throw new StoryException("workspace_entity_read_only", 409); }
            if (saved is null) throw new StoryException("workspace_entity_changed", 409);
            await store.AuditAsync("workspace.entity.updated", account, saved.Id.ToString(), new JsonObject { ["campaign"] = campaign, ["type"] = saved.TypeSlug }, ct);
            return Project(saved, type);
        }
        finally { store.Commands.Release(); }
    }

    public async Task<object> CreateAsync(string campaign, string account, WorkspaceEntityCreate input, CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_workspace_write");
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            var context = await ContextAsync(campaign, account, ct);
            var type = context.Types.GetValueOrDefault(StoryJson.Bounded(input.TypeSlug, 160, true)) ?? throw new StoryException("workspace_type_unavailable", 409);
            if (type.System || type.Slug == "page") throw new StoryException("workspace_type_read_only", 409);
            var parent = string.IsNullOrWhiteSpace(input.Parent) ? context.Root.Id.ToString() : input.Parent!;
            var parentEntity = parent == context.Root.Id.ToString() || parent == context.Root.Slug ? context.Root : context.Entities.SingleOrDefault(e => e.TypeSlug == "page" && (e.Id.ToString() == parent || e.Slug == parent));
            if (parentEntity is null) throw new StoryException("workspace_parent_invalid", 409);
            var data = new JsonObject { ["parent"] = parentEntity.Id.ToString() };
            foreach (var field in type.Fields.Where(f => !f.Sensitive))
            {
                if (input.Data?.TryGetPropertyValue(field.Key, out var value) == true) data[field.Key] = value?.DeepClone();
                else if (field.DefaultValue is not null) data[field.Key] = field.DefaultValue.DeepClone();
            }
            LeafEntity saved;
            try { saved = await store.Entities.CreateAsync(type.Slug, StoryJson.Bounded(input.Name, 300, true), data, ct); }
            catch (InvalidOperationException) { throw new StoryException("workspace_entity_invalid", 409); }
            await store.AuditAsync("workspace.entity.created", account, saved.Id.ToString(), new JsonObject { ["campaign"] = campaign, ["type"] = saved.TypeSlug }, ct);
            return Project(saved, type);
        }
        finally { store.Commands.Release(); }
    }

    public async Task DeleteAsync(string campaign, string account, string entityId, WorkspaceEntityDelete input, CancellationToken ct = default)
    {
        if (input is null || !DateTimeOffset.TryParse(input.ExpectedUpdatedAt, out var expected)) throw new StoryException("invalid_workspace_write");
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            var context = await ContextAsync(campaign, account, ct);
            var entity = context.Entities.SingleOrDefault(e => e.Id == StoryJson.Id(entityId)) ?? throw new StoryException("not_found", 404);
            var type = context.Types.GetValueOrDefault(entity.TypeSlug);
            if (type is null || type.System || entity.TypeSlug == "page") throw new StoryException("workspace_entity_read_only", 409);
            bool deleted;
            try { deleted = await store.Entities.DeleteCanonicalAsync(entity.Id, expected, ct); }
            catch (InvalidOperationException) { throw new StoryException("workspace_entity_read_only", 409); }
            if (!deleted) throw new StoryException("workspace_entity_changed", 409);
            await store.AuditAsync("workspace.entity.deleted", account, entity.Id.ToString(), new JsonObject { ["campaign"] = campaign, ["type"] = entity.TypeSlug }, ct);
        }
        finally { store.Commands.Release(); }
    }

    private async Task<WorkspaceContext> ContextAsync(string campaign, string account, CancellationToken ct)
    {
        await campaigns.MembershipAsync(campaign, account, true, ct);
        var campaignEntity = await store.RequireAsync("storyboard-campaign", campaign, ct);
        var root = await store.Entities.GetAsync(StoryJson.Id(campaignEntity.Data.Text("workspace")), ct);
        if (root is null || root.TypeSlug != "page") throw new StoryException("workspace_unavailable", 409);

        var typeDefinitions = await AllAsync("entity-type", ct);
        var scoped = typeDefinitions.Where(e => e.Data.Text("scope") == root.Slug).ToDictionary(e => e.Slug, StringComparer.Ordinal);
        var typeSlugs = new HashSet<string>(scoped.Keys, StringComparer.Ordinal) { "page" };
        typeSlugs.UnionWith(SystemTypes);

        var pageCandidates = new Dictionary<Guid, LeafEntity>();
        var pageReferences = new HashSet<string>(StringComparer.Ordinal) { root.Id.ToString(), root.Slug };
        var pendingPages = new Queue<string>(pageReferences);
        while (pendingPages.TryDequeue(out var parent))
        {
            foreach (var page in await QueryAsync("page", new Dictionary<string, object?> { ["parent"] = parent }, ct))
            {
                if (page.Id == root.Id || !pageCandidates.TryAdd(page.Id, page)) continue;
                foreach (var reference in new[] { page.Id.ToString(), page.Slug })
                    if (pageReferences.Add(reference)) pendingPages.Enqueue(reference);
            }
        }

        var candidates = new List<LeafEntity>(pageCandidates.Values);
        foreach (var typeSlug in typeSlugs.Where(type => type != "page")) candidates.AddRange(await AllAsync(typeSlug, ct));
        var children = candidates.Where(entity => entity.Data.Text("parent") != "")
            .GroupBy(entity => entity.Data.Text("parent"), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);

        var entities = new Dictionary<Guid, LeafEntity>();
        var parentReferences = new HashSet<string>(StringComparer.Ordinal) { root.Id.ToString(), root.Slug };
        var pendingParents = new Queue<string>(parentReferences);
        while (pendingParents.TryDequeue(out var parent))
        {
            if (!children.TryGetValue(parent, out var directChildren)) continue;
            foreach (var entity in directChildren)
            {
                if (entity.Id == root.Id || !entities.TryAdd(entity.Id, entity)) continue;
                foreach (var reference in new[] { entity.Id.ToString(), entity.Slug })
                    if (parentReferences.Add(reference)) pendingParents.Enqueue(reference);
            }
        }

        // Scoped types remain useful before their first record exists: the explorer needs
        // the schema in order to create that first record.
        var usedTypes = entities.Values.Select(e => e.TypeSlug).Concat(scoped.Keys).Append("page").Distinct(StringComparer.Ordinal);
        var types = new Dictionary<string, WorkspaceType>(StringComparer.Ordinal);
        foreach (var slug in usedTypes)
        {
            var definition = scoped.GetValueOrDefault(slug) ?? typeDefinitions.FirstOrDefault(e => e.Slug == slug);
            var fields = (await QueryAsync("field-definition", new Dictionary<string, object?> { ["parent_type"] = slug }, ct)).Select(Field).Where(f => !f.Sensitive).OrderBy(f => f.SortOrder).ToArray();
            types[slug] = new WorkspaceType(slug, definition?.Name ?? Humanize(slug), definition?.Data.Text("description"), definition?.Data.Text("icon"), definition?.Data.Text("color"), definition?.Data.Text("folder"), SystemTypes.Contains(slug), fields);
        }
        return new(root, entities.Values.ToArray(), types);
    }

    private async Task<IReadOnlyList<LeafEntity>> AllAsync(string type, CancellationToken ct)
    {
        var result = new List<LeafEntity>(); Guid? after = null;
        do { var page = await store.Entities.QueryAsync(new EntityQuery { TypeSlug = type, Limit = 500, OrderById = true, AfterId = after }, ct); result.AddRange(page); if (page.Count < 500) break; after = page[^1].Id; } while (true);
        return result;
    }
    private async Task<IReadOnlyList<LeafEntity>> QueryAsync(string type, IReadOnlyDictionary<string, object?> data, CancellationToken ct)
    {
        var result = new List<LeafEntity>(); Guid? after = null;
        do { var page = await store.Entities.QueryAsync(new EntityQuery { TypeSlug = type, DataEquals = data, Limit = 500, OrderById = true, AfterId = after }, ct); result.AddRange(page); if (page.Count < 500) break; after = page[^1].Id; } while (true);
        return result;
    }
    private static WorkspaceField Field(LeafEntity entity)
    {
        var key = entity.Slug.Contains("--", StringComparison.Ordinal) ? entity.Slug[(entity.Slug.IndexOf("--", StringComparison.Ordinal) + 2)..].Replace('-', '_') : entity.Slug.Replace('-', '_');
        var fieldType = entity.Data.Text("field_type", "string");
        return new(key, entity.Name, fieldType, entity.Data.Number("sort_order"), entity.Data.Flag("is_required"), entity.Data.Text("description"), Parse(entity.Data["constraints"]), Parse(entity.Data["display_hints"]), Parse(entity.Data["default_value"]), Sensitive(key, fieldType));
    }
    private static JsonNode? Parse(JsonNode? node)
    {
        if (node is not JsonValue value || !value.TryGetValue<string>(out var text)) return node?.DeepClone();
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { return JsonNode.Parse(text); } catch (JsonException) { return JsonValue.Create(text); }
    }
    private static bool Sensitive(string key, string type) => type is "secret" or "credential" || new[] { "secret", "token", "password", "credential", "api_key", "private_key" }.Any(part => key.Contains(part, StringComparison.OrdinalIgnoreCase));
    private static object Project(LeafEntity entity, WorkspaceType? type)
    {
        var data = new JsonObject();
        if (type is not null) foreach (var field in type.Fields.Where(f => !f.Sensitive)) if (entity.Data.TryGetPropertyValue(field.Key, out var value)) data[field.Key] = value?.DeepClone();
        foreach (var key in new[] { "icon", "description", "parent" }) if (!data.ContainsKey(key) && entity.Data.TryGetPropertyValue(key, out var value)) data[key] = value?.DeepClone();
        return new { id = entity.Id, typeSlug = entity.TypeSlug, slug = entity.Slug, name = entity.Name, data, createdAt = entity.CreatedAt, updatedAt = entity.UpdatedAt };
    }
    private static string Humanize(string slug) => string.Join(' ', slug.Split('-', StringSplitOptions.RemoveEmptyEntries).Select(word => char.ToUpperInvariant(word[0]) + word[1..]));
    private sealed record WorkspaceContext(LeafEntity Root, IReadOnlyList<LeafEntity> Entities, IReadOnlyDictionary<string, WorkspaceType> Types);
    private sealed record WorkspaceType(string Slug, string Name, string? Description, string? Icon, string? Color, string? Folder, bool System, IReadOnlyList<WorkspaceField> Fields);
    private sealed record WorkspaceField(string Key, string Name, string FieldType, long SortOrder, bool Required, string? Description, JsonNode? Constraints, JsonNode? DisplayHints, JsonNode? DefaultValue, bool Sensitive);
}
