using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Leaf.Sdk;
using Leaf.Sdk.Services;

namespace Storyboard.Testing;

public sealed class FakeAgentConversations : IExternalAgentConversationProvider
{
    private readonly ConcurrentDictionary<string, ExternalConversationHandle> handles = [];
    private readonly ConcurrentDictionary<string, List<ExternalConversationMessage>> transcripts = [];
    private readonly ConcurrentDictionary<string, ExternalConversationAdmission> admissions = [];
    private long sequence;

    public string ProviderId => "fixture-agent-session";
    public int Opens { get; private set; }
    public int Sends { get; private set; }

    public bool CanHandle(string agentSlugOrId) => true;

    public Task<ExternalConversationHandle> OpenAsync(
        ExternalConversationOpenRequest request,
        CancellationToken ct = default)
    {
        var key = request.BindingId + ":" + request.Generation;
        var handle = handles.GetOrAdd(key, _ =>
        {
            Opens++;
            return new ExternalConversationHandle(
                ProviderId,
                request.BindingId,
                request.Generation,
                "fixture-conversation:" + request.BindingId,
                "fixture-session:" + request.BindingId);
        });
        transcripts.TryAdd(handle.SessionId, []);
        return Task.FromResult(handle);
    }

    public Task<ExternalConversationAdmission> SendAsync(
        ExternalConversationHandle handle,
        ExternalConversationInput input,
        CancellationToken ct = default)
    {
        var admission = admissions.GetOrAdd(handle.SessionId + ":" + input.RequestId, _ =>
        {
            Sends++;
            var now = DateTimeOffset.UtcNow;
            var epoch = "fixture-epoch";
            var userUid = "user:" + input.RequestId;
            var messages = transcripts.GetOrAdd(handle.SessionId, []);
            lock (messages)
            {
                messages.Add(new ExternalConversationMessage(
                    new ExternalConversationCursor(epoch, Interlocked.Increment(ref sequence)),
                    userUid,
                    "user",
                    "text",
                    input.Content,
                    now));
                messages.Add(new ExternalConversationMessage(
                    new ExternalConversationCursor(epoch, Interlocked.Increment(ref sequence)),
                    "assistant:" + input.RequestId,
                    "assistant",
                    "text",
                    "Fixture campaign answer",
                    now.AddMilliseconds(1),
                    new JsonObject { ["phase"] = "final_answer" }));
            }
            return new ExternalConversationAdmission(userUid, "accepted");
        });
        return Task.FromResult(admission);
    }

    public Task<ExternalConversationPage> ReadSettledAsync(
        ExternalConversationHandle handle,
        ExternalConversationCursor? after = null,
        int limit = 100,
        CancellationToken ct = default)
    {
        var source = transcripts.GetOrAdd(handle.SessionId, []);
        ExternalConversationMessage[] snapshot;
        lock (source) snapshot = source.OrderBy(value => value.Cursor.Sequence).ToArray();
        var eligible = after is null
            ? snapshot.TakeLast(limit).ToArray()
            : snapshot.Where(value => value.Cursor.Epoch != after.Epoch || value.Cursor.Sequence > after.Sequence).ToArray();
        var messages = eligible.Take(limit).ToArray();
        var next = messages.LastOrDefault()?.Cursor ?? after;
        return Task.FromResult(new ExternalConversationPage(messages, next, true)
        {
            HasMore = eligible.Length > messages.Length,
        });
    }

    public IDisposable SubscribeSettled(Func<ExternalConversationSettled, CancellationToken, Task> handler)
        => NoopDisposable.Instance;

    private sealed class NoopDisposable : IDisposable
    {
        public static readonly NoopDisposable Instance = new();
        public void Dispose() { }
    }
}

public sealed class FakeDiscussions(TestEntities entities) : IDiscussions
{
    private readonly List<DiscussionMessage> messages = [];
    private long nextMessageId;

    public Task<LeafEntity> CreateAsync(
        string? title,
        string? agentSlugOrId = null,
        JsonObject? data = null,
        CancellationToken ct = default)
    {
        var value = data?.DeepClone().AsObject() ?? [];
        value["agent"] ??= agentSlugOrId;
        value["message_count"] ??= 0;
        value["last_activity"] ??= DateTimeOffset.UtcNow.ToString("O");
        var id = value["discussion_id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N");
        return entities.UpsertBySlugAsync("discussion", "discussion-nova-" + id, title ?? "Discussion", value, ct);
    }

    public Task PostAsync(Guid discussionId, string role, string content, JsonObject? metadata = null, string? userId = null, CancellationToken ct = default)
    {
        lock (messages) messages.Add(new DiscussionMessage(
            Interlocked.Increment(ref nextMessageId), discussionId, role, content,
            metadata?.DeepClone().AsObject() ?? [], DateTimeOffset.UtcNow));
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<DiscussionMessage>> GetMessagesAsync(Guid discussionId, int limit = 1000, long afterId = 0, CancellationToken ct = default)
    {
        lock (messages) return Task.FromResult<IReadOnlyList<DiscussionMessage>>(
            messages.Where(value => value.DiscussionId == discussionId && value.Id > afterId).Take(limit).ToArray());
    }

    public Task<IReadOnlyList<DiscussionMessage>> SearchMessagesAsync(string query, int limit = 1000, CancellationToken ct = default)
    {
        lock (messages) return Task.FromResult<IReadOnlyList<DiscussionMessage>>(
            messages.Where(value => value.Content.Contains(query, StringComparison.OrdinalIgnoreCase)).Take(limit).ToArray());
    }

    public Task ClearMessagesAsync(Guid discussionId, CancellationToken ct = default)
    {
        lock (messages) messages.RemoveAll(value => value.DiscussionId == discussionId);
        return Task.CompletedTask;
    }

    public Task SetReactionAsync(Guid discussionId, ReactionChange change, CancellationToken ct = default)
        => Task.CompletedTask;

    public Task<IReadOnlyList<LeafRecord>> GetReactionsAsync(Guid discussionId, DateTimeOffset? since = null, int limit = 1000, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<LeafRecord>>([]);

    public IDisposable Subscribe(Guid discussionId, Func<DiscussionMessage, Task> onMessage)
        => NoopDisposable.Instance;

    private sealed class NoopDisposable : IDisposable
    {
        public static readonly NoopDisposable Instance = new();
        public void Dispose() { }
    }
}
