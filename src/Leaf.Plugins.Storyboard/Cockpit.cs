using Leaf.Sdk;
using Leaf.Sdk.Services;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Leaf.Plugins.Storyboard;

public sealed class StoryCockpit(StoryStore store, StoryCampaigns campaigns, StoryWorkspace workspace, StoryTranscript transcript, IAiInference ai)
{
    private static readonly HashSet<string> Phases = new(StringComparer.Ordinal) { "prepared", "now", "played" };
    private static readonly HashSet<string> Lenses = new(StringComparer.Ordinal) { "beat", "discovery", "belief" };

    public async Task<object> SnapshotAsync(string campaign, string account, CancellationToken ct = default)
    {
        await campaigns.MembershipAsync(campaign, account, true, ct);
        var current = (await store.AllAsync("storyboard-campaign-session", new Dictionary<string, object?> { ["campaign"] = campaign, ["state"] = "active" }, ct)).OrderByDescending(value => value.CreatedAt).FirstOrDefault();
        var entities = await workspace.CockpitEntitiesAsync(campaign, account, limit: 500, ct: ct);
        var byId = entities.ToDictionary(value => value.Entity.Id.ToString(), StringComparer.Ordinal);
        var items = (await store.AllAsync("storyboard-cockpit-item", new Dictionary<string, object?> { ["campaign"] = campaign }, ct))
            .Where(item => item.Data.Flag("active") && byId.ContainsKey(item.Data.Text("entity")))
            .OrderBy(item => item.Data.Text("phase") == "played" ? 0 : item.Data.Text("phase") == "now" ? 1 : 2).ThenBy(item => item.Data.Number("position")).ThenBy(item => item.CreatedAt)
            .Select(item => ProjectItem(item, byId[item.Data.Text("entity")])).ToArray();
        var suggestions = current is null ? [] : (await store.AllAsync("storyboard-cockpit-suggestion", new Dictionary<string, object?> { ["campaign"] = campaign, ["session"] = current.Id.ToString() }, ct))
            .Where(value => value.Data.Text("state") == "proposed").OrderByDescending(value => value.UpdatedAt).Take(8).Select(ProjectSuggestion).ToArray();
        object[] events = [];
        string? cursor = null;
        if (current is not null)
        {
            var recent = await transcript.CockpitEventsAsync(campaign, current.Id.ToString(), account, 12, ct);
            events = recent.Events.Where(value => value.Data.Text("kind") is not "audio" and not "tts").Select(ProjectEvent).ToArray();
            cursor = recent.Events.FirstOrDefault(value => value.Data.Text("kind") is not "audio" and not "tts")?.Data.Text("event_id");
        }
        return new { session = current is null ? null : new { id = current.Id, name = current.Name, state = current.Data.Text("state"), roleplayAnchor = current.Data.Text("roleplay_anchor") }, items, suggestions, events, observationCursor = cursor };
    }

    public async Task<object> SearchAsync(string campaign, string account, string? query, CancellationToken ct = default)
    {
        var values = await workspace.CockpitEntitiesAsync(campaign, account, StoryJson.Bounded(query ?? "", 200), 30, ct);
        return new { items = values.Select(value => value.Projection).ToArray() };
    }

    public async Task<object> PinAsync(string campaign, string account, CockpitPinWrite input, CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_json");
        var operation = StoryJson.Id(input.OperationId).ToString();
        var phase = Phase(input.Phase);
        var lens = Lens(input.Lens);
        var candidates = await workspace.CockpitEntitiesAsync(campaign, account, limit: 500, ct: ct);
        var target = candidates.SingleOrDefault(value => value.Entity.Id == StoryJson.Id(input.EntityId)) ?? throw new StoryException("cockpit_entity_unavailable", 409);
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            await campaigns.MembershipAsync(campaign, account, true, ct);
            var slug = "cockpit-item-" + StoryJson.Hash(campaign + "|" + target.Entity.Id);
            var seed = await store.ProtectAsync(new JsonObject { ["campaign"] = campaign, ["entity"] = target.Entity.Id.ToString(), ["phase"] = phase, ["lens"] = lens, ["position"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["active"] = true, ["created_by"] = account, ["last_operation"] = operation }, ct);
            var saved = await store.ChangeAsync("storyboard-cockpit-item", slug, target.Entity.Name, old =>
            {
                var next = old?.Data.DeepClone().AsObject() ?? seed.DeepClone().AsObject();
                next["phase"] = phase; next["lens"] = lens; next["active"] = true; next["last_operation"] = operation;
                return next;
            }, ct);
            await store.AuditAsync("cockpit.item.pinned", account, saved.Id.ToString(), new JsonObject { ["campaign"] = campaign, ["entity"] = target.Entity.Id.ToString(), ["phase"] = phase }, ct);
            return ProjectItem(saved, target);
        }
        finally { store.Commands.Release(); }
    }

    public async Task<object> MoveAsync(string campaign, string itemId, string account, CockpitMoveWrite input, CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_json");
        var phase = Phase(input.Phase); var lens = Lens(input.Lens); var operation = StoryJson.Id(input.OperationId).ToString();
        var item = await store.RequireAsync("storyboard-cockpit-item", itemId, ct);
        if (item.Data.Text("campaign") != campaign) throw new StoryException("not_found", 404);
        await campaigns.MembershipAsync(campaign, account, true, ct);
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            await campaigns.MembershipAsync(campaign, account, true, ct);
            item = await store.ChangeAsync(item.TypeSlug, item.Slug, item.Name, old => { var next = old!.Data.DeepClone().AsObject(); next["phase"] = phase; next["lens"] = lens; next["position"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); next["last_operation"] = operation; return next; }, ct);
            var target = (await workspace.CockpitEntitiesAsync(campaign, account, limit: 500, ct: ct)).SingleOrDefault(value => value.Entity.Id.ToString() == item.Data.Text("entity")) ?? throw new StoryException("cockpit_entity_unavailable", 409);
            return ProjectItem(item, target);
        }
        finally { store.Commands.Release(); }
    }

    public async Task<object> ObserveAsync(string campaign, string account, CockpitObserveWrite input, CancellationToken ct = default)
    {
        if (input is null) throw new StoryException("invalid_json");
        var recent = await transcript.CockpitEventsAsync(campaign, input.SessionId, account, 12, ct);
        if (recent.Session.Data.Text("state") != "active") throw new StoryException("cockpit_session_ended", 409);
        var useful = recent.Events.Where(value => value.Data.Text("kind") is not "audio" and not "tts" && value.Data.Text("text") != "").ToArray();
        var cursor = useful.FirstOrDefault()?.Data.Text("event_id");
        if (string.IsNullOrWhiteSpace(cursor) || cursor != input.ObservationCursor) throw new StoryException("cockpit_observation_changed", 409);
        var allCandidates = await workspace.CockpitEntitiesAsync(campaign, account, limit: 500, ct: ct);
        var eventTerms = useful.SelectMany(value => value.Data.Text("text").Split([' ', ',', '.', '?', '!', ':', ';', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries)).Where(value => value.Length >= 4).Distinct(StringComparer.OrdinalIgnoreCase).Take(40).ToArray();
        var candidates = allCandidates.OrderByDescending(value => Relevance(value, eventTerms)).ThenBy(value => value.Entity.Name, StringComparer.OrdinalIgnoreCase).Take(80).ToArray();
        if (candidates.Length == 0) return await SnapshotAsync(campaign, account, ct);
        var slug = "cockpit-suggestion-" + StoryJson.Hash(campaign + "|" + recent.Session.Id + "|" + cursor);
        LeafEntity suggestion;
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            await campaigns.MembershipAsync(campaign, account, true, ct);
            var seed = await store.ProtectAsync(new JsonObject { ["campaign"] = campaign, ["session"] = recent.Session.Id.ToString(), ["observation_cursor"] = cursor, ["state"] = "observing", ["created_by"] = account }, ct);
            suggestion = await store.ChangeAsync("storyboard-cockpit-suggestion", slug, "Table observation", old => old?.Data.DeepClone().AsObject() ?? seed.DeepClone().AsObject(), ct);
        }
        finally { store.Commands.Release(); }
        if (suggestion.Data.Text("state") != "observing") return await SnapshotAsync(campaign, account, ct);

        var eventsJson = new JsonArray(useful.Reverse().Select(value => (JsonNode?)new JsonObject { ["id"] = value.Data.Text("event_id"), ["kind"] = value.Data.Text("kind"), ["channel"] = value.Data.Text("channel"), ["text"] = BoundedForPrompt(value.Data.Text("text"), 800), ["actor"] = value.Data["actor"]?.DeepClone() }).ToArray());
        var entitiesJson = new JsonArray(candidates.Select(value => (JsonNode?)new JsonObject { ["id"] = value.Entity.Id.ToString(), ["type"] = value.Entity.TypeSlug, ["typeName"] = value.TypeName, ["name"] = value.Entity.Name, ["data"] = BoundedForPrompt(StoryJson.Object(value.Projection)["data"]?.ToJsonString() ?? "{}", 800) }).ToArray());
        var config = (await store.ConfigAsync(ct))!;
        var provenance = new ComputeProvenance(1, new ComputeOrigin("redleaf", new ComputeAppReference("plugin", "storyboard", null, "Storyboard"), new ComputeEntrypoint("api", "/api/public/storyboard/campaigns/cockpit/observe", "POST")), new ComputeActor("system", "Storyboard", Id: "storyboard"), new ComputeBeneficiary("system", Reason: "Proactive assistance for an authenticated Storyboard GM"), [new ComputeContextReference("campaign", EntityId: campaign), new ComputeContextReference("storyboard-campaign-session", EntityId: recent.Session.Id.ToString())], new ComputeTrace(CorrelationId: suggestion.Id.ToString()), ComputeProvenanceAssurance.Asserted, DateTimeOffset.UtcNow);
        var prompt = "You are the quiet copilot for a tabletop RPG game master. Read the recent table events and the canonical workspace entity catalogue. Propose at most one existing entity the GM is likely to need next. Never invent an entity or change canon. Return strict JSON only: {\"suggest\":true|false,\"entityId\":\"uuid or empty\",\"title\":\"short action title\",\"summary\":\"why now, max 35 words\",\"evidence\":[\"event ids\"],\"confidence\":\"low|medium|high\"}. If nothing is clearly useful, return suggest false.\nEVENTS:\n" + eventsJson.ToJsonString() + "\nENTITIES:\n" + entitiesJson.ToJsonString();
        var result = await ai.OneshotAsync(new AiRequest { Prompt = prompt, QualityMode = config.Data.Text("fast_quality_mode", "fast"), MaxTokens = 260, IdempotencyKey = "storyboard-cockpit-" + suggestion.Id, Provenance = provenance }, ct);
        var answer = ParseAnswer(result.Text, candidates, useful);
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            await campaigns.MembershipAsync(campaign, account, true, ct);
            suggestion = await store.ChangeAsync(suggestion.TypeSlug, suggestion.Slug, answer.Title, old =>
            {
                var next = old!.Data.DeepClone().AsObject(); next["state"] = answer.Suggest ? "proposed" : "empty"; next["entity"] = answer.EntityId; next["title"] = answer.Title; next["summary"] = answer.Summary; next["evidence"] = new JsonArray(answer.Evidence.Select(value => (JsonNode?)value).ToArray()); next["confidence"] = answer.Confidence; next["compute_job"] = result.JobId; return next;
            }, ct);
        }
        finally { store.Commands.Release(); }
        return await SnapshotAsync(campaign, account, ct);
    }

    public async Task<object> DecideAsync(string campaign, string suggestionId, string account, CockpitDecisionWrite input, CancellationToken ct = default)
    {
        if (input is null || input.Decision is not "accept" and not "dismiss") throw new StoryException("invalid_cockpit_decision");
        var operation = StoryJson.Id(input.OperationId).ToString();
        var suggestion = await store.RequireAsync("storyboard-cockpit-suggestion", suggestionId, ct);
        if (suggestion.Data.Text("campaign") != campaign) throw new StoryException("not_found", 404);
        await campaigns.MembershipAsync(campaign, account, true, ct);
        if (input.Decision == "accept" && suggestion.Data.Text("entity") != "") await PinAsync(campaign, account, new CockpitPinWrite(suggestion.Data.Text("entity"), "now", operation), ct);
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            await campaigns.MembershipAsync(campaign, account, true, ct);
            await store.ChangeAsync(suggestion.TypeSlug, suggestion.Slug, suggestion.Name, old => { var next = old!.Data.DeepClone().AsObject(); next["state"] = input.Decision == "accept" ? "accepted" : "dismissed"; next["decided_by"] = account; next["last_operation"] = operation; return next; }, ct);
        }
        finally { store.Commands.Release(); }
        return await SnapshotAsync(campaign, account, ct);
    }

    private static string Phase(string value) { value = StoryJson.Bounded(value, 24, true).ToLowerInvariant(); return Phases.Contains(value) ? value : throw new StoryException("invalid_cockpit_phase"); }
    private static string Lens(string? value) { value = string.IsNullOrWhiteSpace(value) ? "beat" : StoryJson.Bounded(value, 24, true).ToLowerInvariant(); return Lenses.Contains(value) ? value : throw new StoryException("invalid_cockpit_lens"); }
    private static int Relevance(CockpitWorkspaceEntity candidate, IReadOnlyList<string> terms) { var text = candidate.Entity.Name + " " + StoryJson.Object(candidate.Projection)["data"]?.ToJsonString(); return terms.Count(term => text.Contains(term, StringComparison.OrdinalIgnoreCase)); }
    private static string BoundedForPrompt(string value, int max) => value.Length <= max ? value : value[..max];
    private static object ProjectItem(LeafEntity item, CockpitWorkspaceEntity entity) => new { id = item.Id, phase = item.Data.Text("phase"), lens = item.Data.Text("lens", "beat"), position = item.Data.Number("position"), entity = entity.Projection, typeName = entity.TypeName };
    private static object ProjectSuggestion(LeafEntity value) => new { id = value.Id, title = value.Data.Text("title"), summary = value.Data.Text("summary"), entityId = value.Data.Text("entity"), evidence = value.Data["evidence"]?.DeepClone(), confidence = value.Data.Text("confidence"), state = value.Data.Text("state") };
    private static object ProjectEvent(LeafRecord value) => new { id = value.Data.Text("event_id"), kind = value.Data.Text("kind"), channel = value.Data.Text("channel"), text = value.Data.Text("text"), actor = value.Data["actor"]?.DeepClone(), occurredAt = value.Data.Text("occurred_at", value.CreatedAt.ToString("O")) };
    private static CockpitAnswer ParseAnswer(string text, IReadOnlyList<CockpitWorkspaceEntity> candidates, IReadOnlyList<LeafRecord> events)
    {
        var clean = text.Trim(); if (clean.StartsWith("```", StringComparison.Ordinal)) clean = clean.Trim('`').Replace("json\n", "", StringComparison.OrdinalIgnoreCase).Trim();
        JsonObject value; try { value = JsonNode.Parse(clean)?.AsObject() ?? throw new JsonException(); } catch (Exception ex) when (ex is JsonException or InvalidOperationException) { throw new StoryException("cockpit_ai_invalid", 502); }
        var suggest = value["suggest"]?.GetValue<bool>() ?? false; if (!suggest) return new(false, "", "", "", [], "low");
        var entityId = value.Text("entityId"); if (!candidates.Any(candidate => candidate.Entity.Id.ToString() == entityId)) throw new StoryException("cockpit_ai_ungrounded", 502);
        var validEvents = events.Select(item => item.Data.Text("event_id")).ToHashSet(StringComparer.Ordinal);
        var evidence = value["evidence"] is JsonArray array ? array.Select(node => node?.GetValue<string>() ?? "").Where(validEvents.Contains).Distinct(StringComparer.Ordinal).Take(6).ToArray() : [];
        var confidence = value.Text("confidence", "medium").ToLowerInvariant(); if (confidence is not "low" and not "medium" and not "high") confidence = "medium";
        return new(true, entityId, StoryJson.Bounded(value.Text("title", "Relevant now"), 120, true), StoryJson.Bounded(value.Text("summary"), 500), evidence, confidence);
    }
    private sealed record CockpitAnswer(bool Suggest, string EntityId, string Title, string Summary, string[] Evidence, string Confidence);
}
