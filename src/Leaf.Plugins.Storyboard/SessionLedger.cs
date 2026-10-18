using System.Text.Json.Nodes;

namespace Leaf.Plugins.Storyboard;

public sealed class StorySessionLedger(StoryStore store, StoryChanges changes)
{
    public async Task<bool> AppendAsync(string campaign, string operation, string action, string actorType, string actorId, string text, JsonObject details, CancellationToken ct = default)
    {
        var session = (await store.AllAsync("storyboard-campaign-session", new Dictionary<string, object?> { ["campaign"] = campaign, ["state"] = "active" }, ct)).OrderByDescending(value => value.CreatedAt).FirstOrDefault();
        if (session is null) return false;
        var eventId = "ledger-" + StoryJson.Hash(action + ":" + operation)[..32];
        var data = new JsonObject
        {
            ["event_id"] = eventId,
            ["campaign"] = campaign,
            ["session"] = session.Id.ToString(),
            ["recorded_by"] = actorId,
            ["kind"] = "ledger",
            ["channel"] = "meta",
            ["text"] = StoryJson.Bounded(text, 8000, true),
            ["actor"] = new JsonObject
            {
                ["type"] = actorType is "agent" or "system" ? actorType : "gm",
                ["name"] = actorType == "agent" ? "Campaign Agent" : actorType == "system" ? "Storyboard" : "Game Master",
                ["id"] = actorId,
            },
            ["ledger"] = details.DeepClone(),
            ["roleplay_confidence"] = "unknown",
        };
        var appended = await store.Records.AppendOnceAsync("transcript", eventId, data, session.Id, actorId, ct);
        if (appended) changes.BumpGm(campaign, "transcript");
        return appended;
    }
}
