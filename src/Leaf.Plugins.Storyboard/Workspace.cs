using Leaf.Sdk;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Leaf.Plugins.Storyboard;

public sealed record WorkspaceEntityWrite(string Name, JsonObject Data, string ExpectedUpdatedAt);
public sealed record WorkspaceEntityCreate(string TypeSlug, string Name, string? Parent, JsonObject? Data);
public sealed record WorkspaceEntityDelete(string ExpectedUpdatedAt);
public sealed record WorkspaceLocalizationWrite(string? LocalizedName, JsonObject? Fields, string? Status, string? ExpectedUpdatedAt = null);
internal sealed record CockpitWorkspaceEntity(LeafEntity Entity, string TypeName, object Projection);

public sealed class StoryWorkspace(StoryStore store, StoryCampaigns campaigns)
{
    private static readonly HashSet<string> SystemTypes = new(StringComparer.Ordinal)
    {
        "storyboard-campaign", "storyboard-player", "storyboard-character", "storyboard-generation",
        "storyboard-music-playlist", "storyboard-music-playlist-item", "storyboard-music-generation",
        "storyboard-music-candidate", "storyboard-music-queue-item", "storyboard-visual-profile",
        "storyboard-visual", "storyboard-visual-set", "storyboard-visual-set-item",
        "storyboard-visual-generation", "storyboard-visual-candidate", "storyboard-visual-queue-item",
        "storyboard-visual-session", "storyboard-cockpit-item", "storyboard-cockpit-suggestion"
    };
    private static readonly string[] ProtectedKeys = ["owner_id", "owner_agent_id", "owner_plugin", "installation", "confidential", "parent"];

    public async Task<object> SnapshotAsync(string campaign, string account, string? requestedLocale = null, CancellationToken ct = default)
    {
        var context = await ContextAsync(campaign, account, ct);
        var locale = StoryPreferences.Normalize(requestedLocale);
        var localizations = await LocalizationsAsync(campaign, locale, ct);
        return new
        {
            locale,
            root = Project(context.Root, null, localizations.GetValueOrDefault(context.Root.Id), locale),
            entities = context.Entities.OrderBy(e => e.TypeSlug == "page" ? 0 : 1).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).Take(50).Select(e => Project(e, context.Types.GetValueOrDefault(e.TypeSlug), localizations.GetValueOrDefault(e.Id), locale)),
            types = context.Types.Values.OrderBy(t => t.System).ThenBy(t => t.Folder).ThenBy(t => t.Name).Select(t => new
            {
                slug = t.Slug, name = SchemaName(t.Definition, t.Name, localizations, locale), description = SchemaText(t.Definition, "description", t.Description, localizations, locale), icon = t.Icon, color = t.Color,
                folder = SchemaText(t.Definition, "folder", t.Folder, localizations, locale), system = t.System,
                fields = t.Fields.Select(f => new { key = f.Key, name = SchemaName(f.Definition, f.Name, localizations, locale), fieldType = f.FieldType, sortOrder = f.SortOrder, required = f.Required, description = SchemaText(f.Definition, "description", f.Description, localizations, locale), constraints = f.Constraints, displayHints = f.DisplayHints })
            })
        };
    }

    public async Task<object> ListAsync(string campaign, string account, string? types, string? query, string? cursor, int? requestedLimit, string? requestedLocale = null, CancellationToken ct = default)
    {
        var context = await ContextAsync(campaign, account, ct);
        var locale = StoryPreferences.Normalize(requestedLocale);
        var localizations = await LocalizationsAsync(campaign, locale, ct);
        var requested = (types ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToArray();
        if (requested.Length is 0 or > 100 || requested.Any(type => !context.Types.ContainsKey(type))) throw new StoryException("invalid_workspace_query");
        var offset = 0;
        if (!string.IsNullOrWhiteSpace(cursor) && (!int.TryParse(cursor, out offset) || offset < 0)) throw new StoryException("invalid_workspace_query");
        var limit = Math.Clamp(requestedLimit ?? 50, 1, 100);
        var needle = StoryJson.Bounded(query ?? "", 200).Trim();
        var allowed = requested.ToHashSet(StringComparer.Ordinal);
        var matches = context.Entities.Where(entity => allowed.Contains(entity.TypeSlug));
        if (needle.Length > 0) matches = matches.Where(entity =>
            entity.Name.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
            LocalizedSearch(localizations.GetValueOrDefault(entity.Id), needle) ||
            entity.Slug.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
            entity.TypeSlug.Contains(needle, StringComparison.OrdinalIgnoreCase) ||
            (context.Types.GetValueOrDefault(entity.TypeSlug)?.Name?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false));
        var ordered = matches.OrderBy(entity => entity.Name, StringComparer.OrdinalIgnoreCase).ThenBy(entity => entity.TypeSlug, StringComparer.Ordinal).ThenBy(entity => entity.Id).ToArray();
        var items = ordered.Skip(offset).Take(limit).Select(entity => Project(entity, context.Types.GetValueOrDefault(entity.TypeSlug), localizations.GetValueOrDefault(entity.Id), locale)).ToArray();
        var next = offset + items.Length;
        return new { items, total = ordered.Length, nextCursor = next < ordered.Length ? next.ToString() : null };
    }

    internal async Task<IReadOnlyList<CockpitWorkspaceEntity>> CockpitEntitiesAsync(string campaign, string account, string? query = null, int limit = 200, CancellationToken ct = default)
    {
        var context = await ContextAsync(campaign, account, ct);
        var needle = (query ?? "").Trim();
        var candidates = context.Entities.Where(entity => entity.TypeSlug != "page" && context.Types.TryGetValue(entity.TypeSlug, out var type) && !type.System);
        if (needle.Length > 0) candidates = candidates.Where(entity => entity.Name.Contains(needle, StringComparison.OrdinalIgnoreCase) || entity.Slug.Contains(needle, StringComparison.OrdinalIgnoreCase) || entity.Data.ToJsonString().Contains(needle, StringComparison.OrdinalIgnoreCase));
        return candidates.OrderBy(entity => entity.Name, StringComparer.OrdinalIgnoreCase).Take(Math.Clamp(limit, 1, 500)).Select(entity =>
        {
            var type = context.Types[entity.TypeSlug];
            return new CockpitWorkspaceEntity(entity, type.Name, Project(entity, type, null, "en"));
        }).ToArray();
    }

    internal async Task<object[]> AgentEntitiesAsync(string campaign, int limit = 200, CancellationToken ct = default)
    {
        var context = await ContextCoreAsync(campaign, ct);
        return context.Entities
            .Where(entity => entity.TypeSlug != "page"
                             && context.Types.TryGetValue(entity.TypeSlug, out var type)
                             && !type.System)
            .OrderBy(entity => entity.Name, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 500))
            .Select(entity => Project(entity, context.Types[entity.TypeSlug], null, "en"))
            .ToArray();
    }

    internal async Task<IReadOnlyList<CockpitWorkspaceEntity>> AgentCockpitEntitiesAsync(string campaign, int limit = 500, CancellationToken ct = default)
    {
        var context = await ContextCoreAsync(campaign, ct);
        return context.Entities
            .Where(entity => entity.TypeSlug != "page"
                             && context.Types.TryGetValue(entity.TypeSlug, out var type)
                             && !type.System)
            .OrderBy(entity => entity.Name, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 500))
            .Select(entity =>
            {
                var type = context.Types[entity.TypeSlug];
                return new CockpitWorkspaceEntity(entity, type.Name, Project(entity, type, null, "en"));
            })
            .ToArray();
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
            return Project(saved, type, null, "en");
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
            return Project(saved, type, null, "en");
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

    public async Task<object> LocalizationsStatusAsync(string campaign, string account, string? requestedLocale, CancellationToken ct = default)
    {
        var context = await ContextAsync(campaign, account, ct);
        var locale = StoryPreferences.Normalize(requestedLocale);
        var translations = await LocalizationsAsync(campaign, locale, ct);
        var targets = context.Entities.Prepend(context.Root).Concat(context.SchemaEntities).DistinctBy(entity => entity.Id).ToArray();
        string fingerprint(LeafEntity entity) => entity.TypeSlug is "entity-type" or "field-definition" ? SchemaFingerprint(entity) : Fingerprint(entity, context.Types.GetValueOrDefault(entity.TypeSlug));
        var translated = targets.Count(entity => translations.TryGetValue(entity.Id, out var value) && value.Data.Text("source_fingerprint") == fingerprint(entity));
        var stale = targets.Count(entity => translations.TryGetValue(entity.Id, out var value) && value.Data.Text("source_fingerprint") != fingerprint(entity));
        return new { locale, total = targets.Length, translated, stale, missing = targets.Length - translated - stale };
    }

    public Task<object> SaveLocalizationAsync(string campaign, string account, string entityId, string locale, WorkspaceLocalizationWrite input, CancellationToken ct = default)
        => SaveLocalizationCoreAsync(campaign, entityId, locale, input, account, true, ct);

    public Task<object> ImportLocalizationAsync(string campaign, string entityId, string locale, WorkspaceLocalizationWrite input, string actor, CancellationToken ct = default)
        => SaveLocalizationCoreAsync(campaign, entityId, locale, input, actor, false, ct);

    private async Task<object> SaveLocalizationCoreAsync(string campaign, string entityId, string requestedLocale, WorkspaceLocalizationWrite input, string actor, bool requireMembership, CancellationToken ct)
    {
        if (input is null || StoryPreferences.Normalize(requestedLocale) != "fr") throw new StoryException("invalid_locale");
        var status = string.IsNullOrWhiteSpace(input.Status) ? "draft" : input.Status.Trim().ToLowerInvariant();
        if (status is not "draft" and not "reviewed") throw new StoryException("invalid_localization_status");
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            var context = requireMembership ? await ContextAsync(campaign, actor, ct) : await ContextCoreAsync(campaign, ct);
            var targetId = StoryJson.Id(entityId);
            var target = context.Root.Id == targetId ? context.Root : context.Entities.Concat(context.SchemaEntities).FirstOrDefault(entity => entity.Id == targetId) ?? throw new StoryException("not_found", 404);
            if (!string.IsNullOrWhiteSpace(input.ExpectedUpdatedAt) &&
                (!DateTimeOffset.TryParse(input.ExpectedUpdatedAt, out var expectedUpdatedAt) || target.UpdatedAt != expectedUpdatedAt))
                throw new StoryException("localization_source_changed", 409);
            var schema = target.TypeSlug is "entity-type" or "field-definition";
            var type = schema ? null : context.Types.GetValueOrDefault(target.TypeSlug);
            var allowed = schema
                ? new HashSet<string>(target.TypeSlug == "entity-type" ? ["description", "folder"] : ["description"], StringComparer.Ordinal)
                : type?.Fields.Where(Localizable).Select(field => field.Key).ToHashSet(StringComparer.Ordinal) ?? new HashSet<string>(StringComparer.Ordinal);
            var fields = new JsonObject();
            foreach (var field in input.Fields ?? new JsonObject())
            {
                var pointer = field.Key.StartsWith("/", StringComparison.Ordinal) ? field.Key : "/" + EscapePointer(field.Key);
                var rootField = PointerParts(pointer).FirstOrDefault();
                var permitted = rootField is not null && (schema ? allowed.Contains(rootField) : LocalizableKey(rootField) && target.Data.ContainsKey(rootField));
                if (!permitted || field.Value is not JsonValue value || !value.TryGetValue<string>(out var text)) throw new StoryException("invalid_localization_field");
                fields[pointer] = StoryJson.Bounded(text, 100000);
            }
            var localizedName = StoryJson.Bounded(input.LocalizedName ?? "", 300);
            var slug = "loc-" + StoryJson.Hash(campaign + "|" + target.Id + "|fr");
            var sourceFingerprint = schema ? SchemaFingerprint(target) : Fingerprint(target, type);
            var seed = await store.ProtectAsync(new JsonObject
            {
                ["campaign"] = campaign, ["workspace"] = context.Root.Id.ToString(), ["target"] = target.Id.ToString(), ["target_type"] = target.TypeSlug,
                ["locale"] = "fr", ["localized_name"] = localizedName, ["fields"] = fields, ["source_fingerprint"] = sourceFingerprint, ["status"] = status
            }, ct);
            var saved = await store.ChangeAsync("storyboard-localization", slug, "French · " + target.Name, current =>
            {
                var next = current?.Data.DeepClone().AsObject() ?? seed.DeepClone().AsObject();
                next["localized_name"] = localizedName; next["fields"] = fields.DeepClone(); next["source_fingerprint"] = sourceFingerprint; next["status"] = status;
                next["reviewed_by"] = status == "reviewed" && requireMembership ? actor : null; next["reviewed_at"] = status == "reviewed" ? DateTimeOffset.UtcNow.ToString("O") : null;
                return next;
            }, ct);
            await store.AuditAsync("workspace.localization.updated", actor, saved.Id.ToString(), new JsonObject { ["campaign"] = campaign, ["target"] = target.Id.ToString(), ["locale"] = "fr", ["status"] = status }, ct);
            return schema ? ProjectSchema(target, saved, "fr") : Project(target, type, saved, "fr");
        }
        finally { store.Commands.Release(); }
    }

    private async Task<WorkspaceContext> ContextAsync(string campaign, string account, CancellationToken ct)
    {
        await campaigns.MembershipAsync(campaign, account, true, ct);
        return await ContextCoreAsync(campaign, ct);
    }

    private async Task<WorkspaceContext> ContextCoreAsync(string campaign, CancellationToken ct)
    {
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
        var schemaEntities = new Dictionary<Guid, LeafEntity>();
        foreach (var slug in usedTypes)
        {
            var definition = scoped.GetValueOrDefault(slug) ?? typeDefinitions.FirstOrDefault(e => e.Slug == slug);
            if (definition is not null) schemaEntities[definition.Id] = definition;
            var fields = (await QueryAsync("field-definition", new Dictionary<string, object?> { ["parent_type"] = slug }, ct)).Select(Field).Where(f => !f.Sensitive).OrderBy(f => f.SortOrder).ToArray();
            foreach (var field in fields) schemaEntities[field.Definition.Id] = field.Definition;
            types[slug] = new WorkspaceType(slug, definition?.Name ?? Humanize(slug), definition?.Data.Text("description"), definition?.Data.Text("icon"), definition?.Data.Text("color"), definition?.Data.Text("folder"), SystemTypes.Contains(slug), fields, definition);
        }
        return new(root, entities.Values.ToArray(), types, schemaEntities.Values.ToArray());
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
        return new(key, entity.Name, fieldType, entity.Data.Number("sort_order"), entity.Data.Flag("is_required"), entity.Data.Text("description"), Parse(entity.Data["constraints"]), Parse(entity.Data["display_hints"]), Parse(entity.Data["default_value"]), Sensitive(key, fieldType), entity);
    }
    private static JsonNode? Parse(JsonNode? node)
    {
        if (node is not JsonValue value || !value.TryGetValue<string>(out var text)) return node?.DeepClone();
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { return JsonNode.Parse(text); } catch (JsonException) { return JsonValue.Create(text); }
    }
    private static bool Sensitive(string key, string type) => type is "secret" or "credential" || new[] { "secret", "token", "password", "credential", "api_key", "private_key" }.Any(part => key.Contains(part, StringComparison.OrdinalIgnoreCase));
    private async Task<IReadOnlyDictionary<Guid, LeafEntity>> LocalizationsAsync(string campaign, string locale, CancellationToken ct)
    {
        if (locale == "en") return new Dictionary<Guid, LeafEntity>();
        return (await store.AllAsync("storyboard-localization", new Dictionary<string, object?> { ["campaign"] = campaign, ["locale"] = locale }, ct))
            .Where(entity => Guid.TryParse(entity.Data.Text("target"), out _))
            .GroupBy(entity => Guid.Parse(entity.Data.Text("target")))
            .ToDictionary(group => group.Key, group => group.OrderByDescending(entity => entity.UpdatedAt).First());
    }
    private static bool LocalizedSearch(LeafEntity? localization, string needle)
    {
        if (localization is null) return false;
        if (localization.Data.Text("localized_name").Contains(needle, StringComparison.OrdinalIgnoreCase)) return true;
        return localization.Data["fields"] is JsonObject fields && fields.Any(field => field.Value?.ToString().Contains(needle, StringComparison.OrdinalIgnoreCase) == true);
    }
    private static bool Localizable(WorkspaceField field) => field.FieldType is "string" or "text" or "markdown" or "json" or "any" && LocalizableKey(field.Key);
    private static bool LocalizableKey(string key) => key is not (
        "slug" or "code" or "key" or "locale" or "language" or "url" or "image" or "image_url" or "audio" or "video" or "asset" or "public_slug" or
        "parent" or "event" or "world" or "system" or "platform" or "to_system" or "from_system" or "featured_world" or "account" or "campaign" or "workspace" or
        "source_name" or "target_system_key" or "axis_target_system_key" or "system_key" or "body_key" or "route_key" or "platform_key" or "forecast_key" or "site_key" or "designation");
    private static string Fingerprint(LeafEntity entity, WorkspaceType? type)
    {
        var source = new JsonObject { ["name"] = entity.Name };
        var declared = type?.Fields.Where(Localizable).Select(field => field.Key) ?? [];
        var extra = entity.Data.Where(field => LocalizableKey(field.Key) && field.Value is JsonObject or JsonArray || LocalizableKey(field.Key) && field.Value is JsonValue scalar && scalar.TryGetValue<string>(out _)).Select(field => field.Key);
        foreach (var key in declared.Concat(extra).Distinct(StringComparer.Ordinal).OrderBy(key => key, StringComparer.Ordinal))
            if (entity.Data.TryGetPropertyValue(key, out var value)) source[key] = value?.DeepClone();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source.ToJsonString()))).ToLowerInvariant();
    }
    private static object Project(LeafEntity entity, WorkspaceType? type, LeafEntity? localization, string locale)
    {
        var data = new JsonObject();
        if (type is not null) foreach (var field in type.Fields.Where(f => !f.Sensitive)) if (entity.Data.TryGetPropertyValue(field.Key, out var value)) data[field.Key] = value?.DeepClone();
        foreach (var key in new[] { "icon", "description", "parent" }) if (!data.ContainsKey(key) && entity.Data.TryGetPropertyValue(key, out var value)) data[key] = value?.DeepClone();
        var fingerprint = Fingerprint(entity, type);
        var exact = locale != "en" && localization is not null && localization.Data.Text("source_fingerprint") == fingerprint;
        if (exact && localization!.Data["fields"] is JsonObject fields && type is not null)
            foreach (var field in fields) ApplyPointer(data, field.Key.StartsWith("/", StringComparison.Ordinal) ? field.Key : "/" + EscapePointer(field.Key), field.Value);
        var translatedName = exact ? localization!.Data.Text("localized_name") : "";
        var localizationState = locale == "en" ? "source" : localization is null ? "missing" : exact ? localization.Data.Text("status", "draft") : "stale";
        return new { id = entity.Id, typeSlug = entity.TypeSlug, slug = entity.Slug, name = translatedName == "" ? entity.Name : translatedName, data, createdAt = entity.CreatedAt, updatedAt = entity.UpdatedAt, localization = new { locale, status = localizationState, sourceFingerprint = fingerprint } };
    }
    private static string SchemaFingerprint(LeafEntity entity)
    {
        var source = new JsonObject { ["name"] = entity.Name };
        foreach (var key in entity.TypeSlug == "entity-type" ? new[] { "description", "folder" } : new[] { "description" })
            if (entity.Data.TryGetPropertyValue(key, out var value)) source[key] = value?.DeepClone();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source.ToJsonString()))).ToLowerInvariant();
    }
    private static bool ExactSchema(LeafEntity definition, LeafEntity? localization, string locale)
        => locale != "en" && localization is not null && localization.Data.Text("source_fingerprint") == SchemaFingerprint(definition);
    private static string SchemaName(LeafEntity? definition, string fallback, IReadOnlyDictionary<Guid, LeafEntity> localizations, string locale)
    {
        if (definition is null || !localizations.TryGetValue(definition.Id, out var localization) || !ExactSchema(definition, localization, locale)) return fallback;
        var translated = localization.Data.Text("localized_name");
        return translated == "" ? fallback : translated;
    }
    private static string? SchemaText(LeafEntity? definition, string key, string? fallback, IReadOnlyDictionary<Guid, LeafEntity> localizations, string locale)
    {
        if (definition is null || !localizations.TryGetValue(definition.Id, out var localization) || !ExactSchema(definition, localization, locale)) return fallback;
        if (localization.Data["fields"] is not JsonObject fields) return fallback;
        var pointer = "/" + EscapePointer(key);
        return fields[pointer]?.GetValue<string>() ?? fields[key]?.GetValue<string>() ?? fallback;
    }
    private static object ProjectSchema(LeafEntity entity, LeafEntity localization, string locale)
    {
        var exact = ExactSchema(entity, localization, locale);
        var data = entity.Data.DeepClone().AsObject();
        if (exact && localization.Data["fields"] is JsonObject fields)
            foreach (var field in fields) ApplyPointer(data, field.Key.StartsWith("/", StringComparison.Ordinal) ? field.Key : "/" + EscapePointer(field.Key), field.Value);
        var localizedName = exact ? localization.Data.Text("localized_name") : "";
        return new { id = entity.Id, typeSlug = entity.TypeSlug, slug = entity.Slug, name = localizedName == "" ? entity.Name : localizedName, data, createdAt = entity.CreatedAt, updatedAt = entity.UpdatedAt, localization = new { locale, status = exact ? localization.Data.Text("status", "draft") : "stale", sourceFingerprint = SchemaFingerprint(entity) } };
    }
    private static string EscapePointer(string value) => value.Replace("~", "~0", StringComparison.Ordinal).Replace("/", "~1", StringComparison.Ordinal);
    private static string[] PointerParts(string pointer)
    {
        if (!pointer.StartsWith("/", StringComparison.Ordinal)) return [];
        return pointer.Split('/').Skip(1).Select(part => part.Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal)).ToArray();
    }
    private static void ApplyPointer(JsonObject root, string pointer, JsonNode? value)
    {
        var parts = PointerParts(pointer);
        if (parts.Length == 0) return;
        JsonNode? current = root;
        for (var index = 0; index < parts.Length - 1; index++)
        {
            current = current switch
            {
                JsonObject obj when obj.TryGetPropertyValue(parts[index], out var child) => child,
                JsonArray array when int.TryParse(parts[index], out var item) && item >= 0 && item < array.Count => array[item],
                _ => null
            };
            if (current is null) return;
        }
        var key = parts[^1];
        if (current is JsonObject target) target[key] = value?.DeepClone();
        else if (current is JsonArray array && int.TryParse(key, out var item) && item >= 0 && item < array.Count) array[item] = value?.DeepClone();
    }
    private static string Humanize(string slug) => string.Join(' ', slug.Split('-', StringSplitOptions.RemoveEmptyEntries).Select(word => char.ToUpperInvariant(word[0]) + word[1..]));
    private sealed record WorkspaceContext(LeafEntity Root, IReadOnlyList<LeafEntity> Entities, IReadOnlyDictionary<string, WorkspaceType> Types, IReadOnlyList<LeafEntity> SchemaEntities);
    private sealed record WorkspaceType(string Slug, string Name, string? Description, string? Icon, string? Color, string? Folder, bool System, IReadOnlyList<WorkspaceField> Fields, LeafEntity? Definition);
    private sealed record WorkspaceField(string Key, string Name, string FieldType, long SortOrder, bool Required, string? Description, JsonNode? Constraints, JsonNode? DisplayHints, JsonNode? DefaultValue, bool Sensitive, LeafEntity Definition);
}
