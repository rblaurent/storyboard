using Leaf.Sdk;
using Leaf.Sdk.Services;
using Leaf.Plugins.Storyboard;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Storyboard.Testing;

// Test adapter only. Production always uses plugin-keyed Leaf entity/record stores.
// Optional persistence is used by the explicitly labelled, isolated UI fixture host.
public sealed class TestEntities : IEntityStore
{
    private readonly object gate = new();
    private readonly Dictionary<Guid, LeafEntity> entities = [];
    private readonly string? path;
    private long revision;
    public Action<string,string,JsonObject>? BeforeCas {get;set;}
    public List<EntityQuery> Queries {get;}=[];
    public TestEntities(string? path = null)
    {
        this.path = path;
        if (path is not null && File.Exists(path)) foreach (var e in JsonSerializer.Deserialize<LeafEntity[]>(File.ReadAllText(path), StoryJson.Options)!) entities[e.Id] = e;
    }
    private static LeafEntity Clone(LeafEntity e) => e with { Data = e.Data.DeepClone().AsObject() };
    public IReadOnlyList<LeafEntity> Snapshot() { lock (gate) return entities.Values.Select(Clone).ToArray(); }
    public void Seed(IEnumerable<LeafEntity> fixtureRows) { lock (gate) foreach (var row in fixtureRows) entities.Add(row.Id, Clone(row)); }
    public Task<LeafEntity?> GetAsync(Guid id, CancellationToken ct = default) { lock (gate) return Task.FromResult(entities.TryGetValue(id, out var e) ? Clone(e) : null); }
    public Task<LeafEntity?> GetBySlugAsync(string slug, CancellationToken ct = default) { lock (gate) return Task.FromResult(entities.Values.Where(e => e.Slug == slug).Select(Clone).FirstOrDefault()); }
    public Task<LeafEntity?> GetBySlugAsync(string typeSlug, string slug, CancellationToken ct = default) { lock (gate) return Task.FromResult(entities.Values.Where(e => e.TypeSlug == typeSlug && e.Slug == slug).Select(Clone).SingleOrDefault()); }
    public Task<IReadOnlyList<LeafEntity>> QueryAsync(EntityQuery q, CancellationToken ct = default)
    {
        lock (gate) { Queries.Add(q); return Task.FromResult<IReadOnlyList<LeafEntity>>(entities.Values.Where(e => e.TypeSlug == q.TypeSlug &&
            (q.DataEquals is null || q.DataEquals.All(kv => JsonNode.DeepEquals(e.Data[kv.Key], JsonSerializer.SerializeToNode(kv.Value)))))
            .Where(e => q.AfterId is null || e.Id.CompareTo(q.AfterId.Value) > 0)
            .OrderBy(e => q.OrderById ? e.Id.ToString("N") : e.Slug, StringComparer.Ordinal).Skip(q.Offset).Take(q.Limit).Select(Clone).ToArray()); }
    }
    public Task<LeafEntity?> CompareExchangeBySlugAsync(string type, string slug, string name, JsonObject data, DateTimeOffset? expected, CancellationToken ct = default)
    {
        lock (gate)
        {
            BeforeCas?.Invoke(type,slug,data);
            var old = entities.Values.SingleOrDefault(e => e.TypeSlug == type && e.Slug == slug);
            if (old?.UpdatedAt != expected) return Task.FromResult<LeafEntity?>(null);
            var time = DateTimeOffset.UtcNow.AddTicks(Interlocked.Increment(ref revision) * 10);
            var e = new LeafEntity(old?.Id ?? Guid.NewGuid(), type, slug, name, data.DeepClone().AsObject(), old?.CreatedAt ?? time, time, "test");
            entities[e.Id] = e;
            if (path is not null) { File.WriteAllText(path + ".new", JsonSerializer.Serialize(entities.Values, StoryJson.Options)); File.Move(path + ".new", path, true); }
            return Task.FromResult<LeafEntity?>(Clone(e));
        }
    }
    public Task<LeafEntity> CreateAsync(string type, string name, JsonObject? data = null, CancellationToken ct = default) => UpsertBySlugAsync(type, Guid.NewGuid().ToString(), name, data, ct);
    public async Task<LeafEntity> UpsertBySlugAsync(string type, string slug, string name, JsonObject? data = null, CancellationToken ct = default)
    {
        var old = await GetBySlugAsync(type, slug, ct);
        return (await CompareExchangeBySlugAsync(type, slug, name, data ?? [], old?.UpdatedAt, ct))!;
    }
    public async Task<LeafEntity> PatchAsync(Guid id, JsonObject patch, string? name = null, CancellationToken ct = default)
    {
        var old = (await GetAsync(id, ct))!;
        foreach (var p in patch) old.Data[p.Key] = p.Value?.DeepClone();
        return (await CompareExchangeBySlugAsync(old.TypeSlug, old.Slug, name ?? old.Name, old.Data, old.UpdatedAt, ct))!;
    }
    public async Task<LeafEntity> ReplaceDataAsync(Guid id, JsonObject data, string? name = null, CancellationToken ct = default)
    {
        var old = (await GetAsync(id, ct))!;
        return (await CompareExchangeBySlugAsync(old.TypeSlug, old.Slug, name ?? old.Name, data, old.UpdatedAt, ct))!;
    }
    public Task DeleteAsync(Guid id, CancellationToken ct = default) { lock (gate) entities.Remove(id); return Task.CompletedTask; }
}
public sealed class TestRecords : IRecordStreams
{
    private readonly List<LeafRecord> records = [];
    private readonly Dictionary<string, LeafRecord> keys = [];
    public Task<bool> AppendOnceAsync(string stream, string operationId, JsonObject data, Guid? entityId = null, string? userId = null, CancellationToken ct = default)
    {
        lock(records) {
            if(keys.ContainsKey(stream+":"+operationId)) return Task.FromResult(false);
            var record=new LeafRecord(records.Count+1,stream,entityId,userId,data.DeepClone().AsObject(),DateTimeOffset.UtcNow);
            keys[stream+":"+operationId]=record;records.Add(record);return Task.FromResult(true);
        }
    }
    public Task AppendAsync(string stream, JsonObject data, Guid? entityId = null, string? userId = null, CancellationToken ct = default)
    {
        lock (records) records.Add(new(records.Count + 1, stream, entityId, userId, data.DeepClone().AsObject(), DateTimeOffset.UtcNow));
        return Task.CompletedTask;
    }
    public Task<IReadOnlyList<LeafRecord>> QueryAsync(string stream, RecordQuery? q = null, CancellationToken ct = default)
    {
        lock (records) {
            IEnumerable<LeafRecord> source = q?.ExternalId is null ? records : keys.TryGetValue(stream+":"+q.ExternalId,out var record) ? [record] : [];
            return Task.FromResult<IReadOnlyList<LeafRecord>>(source.Where(r => r.Stream == stream && (q?.EntityId is null || r.EntityId == q.EntityId)).Reverse().Take(q?.Limit ?? 100).ToArray());
        }
    }
}
public sealed class TestClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
    public override DateTimeOffset GetUtcNow() => Now;
}
