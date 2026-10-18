using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

namespace Leaf.Plugins.Storyboard;

public sealed record StoryChangeEnvelope(string Token, string[] Topics);

public sealed class StoryChanges
{
    private static readonly string[] GmTopics = ["visuals", "music", "transcript", "cockpit", "players", "play-mode"];
    private static readonly string[] PlayerTopics = ["visuals", "music", "players", "play-mode"];
    private readonly string epoch = Guid.NewGuid().ToString("N");
    private readonly ConcurrentDictionary<string, CampaignChanges> campaigns = new();
    private readonly ConcurrentDictionary<string, int> waiters = new();

    public void Bump(string campaign, params string[] topics)
    {
        if (string.IsNullOrWhiteSpace(campaign) || topics.Length == 0) return;
        var state = campaigns.GetOrAdd(campaign, _ => new());
        TaskCompletionSource signal;
        lock (state.Gate)
        {
            foreach (var topic in topics.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal))
                state.Revisions[topic] = state.Revisions.GetValueOrDefault(topic) + 1;
            signal = state.Signal;
            state.Signal = NewSignal();
        }
        signal.TrySetResult();
    }

    public async Task<StoryChangeEnvelope> WaitAsync(string campaign, string membership, bool gm, string? since, CancellationToken ct)
    {
        var visible = gm ? GmTopics : [.. PlayerTopics, "journal:" + membership];
        var state = campaigns.GetOrAdd(campaign, _ => new());
        var parsed = Decode(since);
        if (parsed is null || parsed.Epoch != epoch || parsed.Campaign != campaign)
            return Snapshot(campaign, visible, state, visible);

        var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
        while (true)
        {
            Task signal;
            string[] changed;
            lock (state.Gate)
            {
                changed = visible.Where(topic => state.Revisions.GetValueOrDefault(topic) > parsed.Revisions.GetValueOrDefault(topic)).ToArray();
                if (changed.Length > 0) return SnapshotLocked(campaign, visible, state, changed);
                signal = state.Signal.Task;
            }

            var waiterKey = campaign + ":" + membership;
            if (waiters.AddOrUpdate(waiterKey, 1, (_, count) => count + 1) > 2)
            {
                waiters.AddOrUpdate(waiterKey, 0, (_, count) => Math.Max(0, count - 1));
                throw new StoryException("too_many_change_waiters", 429);
            }
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                var remaining = deadline - DateTimeOffset.UtcNow;
                if (remaining <= TimeSpan.Zero) return new(since!, []);
                timeout.CancelAfter(remaining);
                try { await signal.WaitAsync(timeout.Token); }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return new(since!, []); }
            }
            finally { waiters.AddOrUpdate(waiterKey, 0, (_, count) => Math.Max(0, count - 1)); }
        }
    }

    private StoryChangeEnvelope Snapshot(string campaign, string[] visible, CampaignChanges state, string[] topics)
    {
        lock (state.Gate) return SnapshotLocked(campaign, visible, state, topics);
    }

    private StoryChangeEnvelope SnapshotLocked(string campaign, string[] visible, CampaignChanges state, string[] topics)
    {
        var token = Encode(new Token(epoch, campaign, visible.ToDictionary(topic => topic, topic => state.Revisions.GetValueOrDefault(topic), StringComparer.Ordinal)));
        return new(token, topics);
    }

    private static string Encode(Token value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static Token? Decode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 4096) return null;
        try
        {
            var padded = value.Replace('-', '+').Replace('_', '/').PadRight((value.Length + 3) / 4 * 4, '=');
            return JsonSerializer.Deserialize<Token>(Encoding.UTF8.GetString(Convert.FromBase64String(padded)));
        }
        catch { return null; }
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private sealed class CampaignChanges { public object Gate { get; } = new(); public Dictionary<string, long> Revisions { get; } = new(StringComparer.Ordinal); public TaskCompletionSource Signal { get; set; } = NewSignal(); }
    private sealed record Token(string Epoch, string Campaign, Dictionary<string, long> Revisions);
}
