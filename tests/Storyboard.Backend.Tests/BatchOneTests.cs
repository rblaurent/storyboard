using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Leaf.Plugins.Storyboard;
using Leaf.Sdk.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Storyboard.Testing;

public sealed class BatchOneTests
{
    [Fact]
    public async Task RecorderLeaseRequiresExplicitTakeoverAndPublishesDeviceHealth()
    {
        await using var f = await Fixture.Create();
        var campaign = f.Campaign.Id.ToString();
        var session = StoryJson.Object(await f.Transcript.StartSessionAsync(campaign, f.Gm.Id.ToString(), new("Table", "Dusk", Guid.NewGuid().ToString())));
        var first = StoryJson.Object(await f.Transcript.RecorderAsync(campaign, session.Text("id"), f.Gm.Id.ToString(), new("mele", "Windows · Edge", "Poly Sync 60")));
        Assert.True(first.Flag("recorderLive"));
        Assert.Equal("Poly Sync 60", first.Text("recorderMic"));
        var conflict = await Assert.ThrowsAsync<StoryException>(() => f.Transcript.RecorderAsync(campaign, session.Text("id"), f.Gm.Id.ToString(), new("tablet", "Android · Chrome", "Tablet microphone")));
        Assert.Equal("recording_owned", conflict.Code);
        var takeover = StoryJson.Object(await f.Transcript.RecorderAsync(campaign, session.Text("id"), f.Gm.Id.ToString(), new("tablet", "Android · Chrome", "Tablet microphone", true)));
        Assert.Equal("tablet", takeover.Text("recorderClientId"));
    }

    [Fact]
    public async Task PerPlayerRevealIsIdempotentAndDoesNotRestampDiscovery()
    {
        await using var f = await Fixture.Create();
        var campaign = await f.Store.RequireAsync("storyboard-campaign", f.Campaign.Id.ToString());
        var root = (await f.Entities.GetAsync(StoryJson.Id(campaign.Data.Text("workspace"))))!;
        await f.Entities.UpsertBySlugAsync("entity-type", "fixture-discovery", "Discovery", new() { ["scope"] = root.Slug });
        var entity = await f.Entities.UpsertBySlugAsync("fixture-discovery", "quiet-bell", "Quiet bell", new() { ["parent"] = root.Id.ToString() });
        await f.Workspace.SavePlayerViewAsync(campaign.Id.ToString(), f.Gm.Id.ToString(), entity.Id.ToString(), new("Quiet bell", "It rings without moving.", null, [], entity.UpdatedAt.ToString("O"), Guid.NewGuid().ToString()));
        var member = await f.Campaigns.MembershipAsync(campaign.Id.ToString(), f.Player.Id.ToString());
        await f.Visibility.SetAsync(campaign.Id.ToString(), f.Gm.Id.ToString(), entity.Id.ToString(), new(false, [member.Id.ToString()], true, Guid.NewGuid().ToString()));
        var first = (await f.Store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign.Id.ToString(), ["entity"] = entity.Id.ToString() })).Single();
        var revealedAt = first.Data.Text("revealed_at");
        await f.Visibility.SetAsync(campaign.Id.ToString(), f.Gm.Id.ToString(), entity.Id.ToString(), new(false, [member.Id.ToString()], true, Guid.NewGuid().ToString()));
        var second = (await f.Store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign.Id.ToString(), ["entity"] = entity.Id.ToString() })).Single();
        Assert.Equal(revealedAt, second.Data.Text("revealed_at"));
        Assert.Single(StoryJson.Object(await f.Visibility.JournalAsync(campaign.Id.ToString(), f.Player.Id.ToString()))["items"]!.AsArray());
    }

    [Fact]
    public async Task LegacyRevealMigrationIsIdempotentAndPreservesRevealTime()
    {
        await using var f = await Fixture.Create();
        var campaign = f.Campaign.Id.ToString();
        var player = await f.Campaigns.MembershipAsync(campaign, f.Player.Id.ToString());
        var revealedAt = "2026-04-03T02:01:00.0000000+00:00";
        var legacy = await f.Store.ProtectAsync(new JsonObject
        {
            ["campaign"] = campaign, ["entity"] = Guid.NewGuid().ToString(), ["audience"] = "all",
            ["players"] = new JsonArray(), ["active"] = true, ["revealed_at"] = revealedAt,
            ["updated_by"] = f.Gm.Id.ToString(), ["last_operation"] = Guid.NewGuid().ToString()
        });
        await f.Store.ChangeAsync("storyboard-entity-visibility", "legacy-reveal", "Legacy reveal", _ => legacy);

        await f.Visibility.MigrateAsync();
        await f.Visibility.MigrateAsync();

        var migrated = await f.Store.AllAsync("storyboard-entity-visibility", new Dictionary<string, object?> { ["campaign"] = campaign });
        var record = Assert.Single(migrated);
        Assert.Equal(player.Id.ToString(), record.Data.Text("player"));
        Assert.Equal(revealedAt, record.Data.Text("revealed_at"));
        Assert.DoesNotContain(migrated, value => value.Data.Text("player") == "");
    }

    [Fact]
    public async Task DuplicateTrackEndAdvancesOnlyOnce()
    {
        await using var f = await Fixture.Create();
        using var client = await f.Host();
        var music = f.App!.Services.GetRequiredService<StoryMusic>();
        var campaign = f.Campaign.Id.ToString();
        var one = StoryJson.Object(await music.SaveTrackAsync(campaign, f.Gm.Id.ToString(), new("One", "Fixture", null, null, 1000, "spotify:track:1111111111111111111111"), default));
        var two = StoryJson.Object(await music.SaveTrackAsync(campaign, f.Gm.Id.ToString(), new("Two", "Fixture", null, null, 1000, "spotify:track:2222222222222222222222"), default));
        await music.EnqueueAsync(campaign, f.Gm.Id.ToString(), new(one.Text("id"), null, Guid.NewGuid().ToString()), default);
        await music.EnqueueAsync(campaign, f.Gm.Id.ToString(), new(two.Text("id"), null, Guid.NewGuid().ToString()), default);
        await music.RegisterProjectionOutputAsync(campaign, f.Gm.Id.ToString(), new("tv", "device", "TV"), default);
        var playing = StoryJson.Object(await music.ProjectionCommandAsync(campaign, f.Gm.Id.ToString(), new("play", Guid.NewGuid().ToString(), 0, one.Text("id")), default));
        var endedRevision = playing.Number("revision");
        var advanced = StoryJson.Object(await music.ProjectionCommandAsync(campaign, f.Gm.Id.ToString(), new("ended", Guid.NewGuid().ToString(), (long)endedRevision, one.Text("id")), default));
        var duplicate = StoryJson.Object(await music.ProjectionCommandAsync(campaign, f.Gm.Id.ToString(), new("ended", Guid.NewGuid().ToString(), (long)endedRevision, one.Text("id")), default));
        Assert.Equal(two.Text("id"), advanced["track"]!.AsObject().Text("id"));
        Assert.Equal(advanced.Number("revision"), duplicate.Number("revision"));
        Assert.Equal(two.Text("id"), duplicate["track"]!.AsObject().Text("id"));
        var playerState = StoryJson.Object(await music.ProjectionStateAsync(campaign, f.Player.Id.ToString(), default));
        Assert.Equal(new[] { "artist", "name" }, playerState["track"]!.AsObject().Select(value => value.Key).Order().ToArray());
    }

    [Fact]
    public async Task EndlessMusicStartsAtMostOneLookaheadGeneration()
    {
        await using var f = await Fixture.Create();
        using var client = await f.Host();
        var music = f.App!.Services.GetRequiredService<StoryMusic>();
        var campaign = f.Campaign.Id.ToString();
        var track = StoryJson.Object(await music.SaveTrackAsync(campaign, f.Gm.Id.ToString(), new("One", "Fixture", null, null, 1000, "spotify:track:1111111111111111111111"), default));
        await music.EnqueueAsync(campaign, f.Gm.Id.ToString(), new(track.Text("id"), null, Guid.NewGuid().ToString()), default);
        await music.RegisterProjectionOutputAsync(campaign, f.Gm.Id.ToString(), new("tv", "device", "TV"), default);
        var playing = StoryJson.Object(await music.ProjectionCommandAsync(campaign, f.Gm.Id.ToString(), new("play", Guid.NewGuid().ToString(), 0, track.Text("id")), default));
        await music.ProjectionCommandAsync(campaign, f.Gm.Id.ToString(), new("endless", Guid.NewGuid().ToString(), (long)playing.Number("revision"), Endless: true), default);
        f.Compute.NextText = new AiCompletion("{\"title\":\"Ahead\",\"prompt\":\"Seamless instrumental continuation\",\"style\":\"cinematic ambient\",\"negativeTags\":\"vocals\",\"mood\":\"tense\",\"energy\":\"low\",\"tempo\":\"slow\",\"instruments\":[\"strings\"],\"narrativeArc\":\"sustain\",\"durationSeconds\":120}", "fixture", "brief");

        await Task.WhenAll(music.ProcessEndlessOnceAsync(), music.ProcessEndlessOnceAsync());

        var generations = await f.Store.AllAsync("storyboard-music-generation", new Dictionary<string, object?> { ["campaign"] = campaign });
        var generation = Assert.Single(generations);
        var session = Assert.Single(await f.Store.AllAsync("storyboard-music-session", new Dictionary<string, object?> { ["campaign"] = campaign }));
        Assert.NotEmpty(session.Data.Text("lookahead_operation"));
        await f.Entities.PatchAsync(generation.Id, new JsonObject { ["state"] = "completed" });
        var candidate = await f.Store.ProtectAsync(new JsonObject { ["campaign"] = campaign, ["generation"] = generation.Id.ToString(), ["audio_asset"] = "generated-audio.mp3", ["cover_asset"] = "", ["duration_seconds"] = 120, ["promoted_track"] = "" });
        await f.Store.ChangeAsync("storyboard-music-candidate", "endless-candidate", "Ahead", _ => candidate);
        await music.ProjectionCommandAsync(campaign, f.Gm.Id.ToString(), new("ended", Guid.NewGuid().ToString(), (long)session.Data.Number("revision"), track.Text("id")), default);
        await music.ProcessEndlessOnceAsync();
        session = Assert.Single(await f.Store.AllAsync("storyboard-music-session", new Dictionary<string, object?> { ["campaign"] = campaign }));
        Assert.True(session.Data.Flag("playing"));
        Assert.False(session.Data.Flag("awaiting_endless_resume"));
        Assert.NotEqual(track.Text("id"), session.Data.Text("track"));
    }

    [Fact]
    public async Task SlideshowAdvancesWhileAVisualGenerationIsInFlight()
    {
        await using var f = await Fixture.Create();
        var campaign = f.Campaign.Id.ToString();
        async Task<Leaf.Sdk.LeafEntity> Visual(string slug, string name)
        {
            var data = await f.Store.ProtectAsync(new JsonObject { ["campaign"] = campaign, ["image_asset"] = slug + ".png", ["active"] = true });
            return await f.Store.ChangeAsync("storyboard-visual", slug, name, _ => data);
        }
        var first = await Visual("timer-first", "First");
        var second = await Visual("timer-second", "Second");
        await f.Visuals.EnqueueAsync(campaign, f.Gm.Id.ToString(), new(first.Id.ToString(), null, Guid.NewGuid().ToString()), default);
        await f.Visuals.EnqueueAsync(campaign, f.Gm.Id.ToString(), new(second.Id.ToString(), null, Guid.NewGuid().ToString()), default);
        await f.Visuals.CommandAsync(campaign, f.Gm.Id.ToString(), new("play", Guid.NewGuid().ToString(), 0), default);
        var session = (await f.Entities.GetBySlugAsync("storyboard-visual-session", "visual-session-" + campaign))!;
        await f.Entities.PatchAsync(session.Id, new JsonObject { ["next_at"] = 1 });

        var started = StoryJson.Object(await f.Visuals.StartGenerationAsync(campaign, f.Gm.Id.ToString(), new(
            Guid.NewGuid().ToString(), "A separate slow generation",
            new VisualBriefWrite("Slow", "crossfade", 20, [new("Slow frame", "A distant storm", "tense", ["storm"])]), true), default));
        var generation = await f.Store.RequireAsync("storyboard-visual-generation", started.Text("id"));
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        f.Compute.DuringImage = async () => { entered.TrySetResult(); await release.Task; };
        var generationTask = f.Visuals.RunGenerationAsync(generation, default);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        try
        {
            await f.Visuals.AdvanceSessionsOnceAsync().WaitAsync(TimeSpan.FromSeconds(2));
            session = (await f.Entities.GetAsync(session.Id))!;
            Assert.Equal(second.Id.ToString(), session.Data.Text("current_visual"));
        }
        finally { release.TrySetResult(); await generationTask; }
    }

    [Fact]
    public async Task PlayerAndOutsiderAreDeniedGmLibrariesAndRawTranscript()
    {
        await using var f = await Fixture.Create();
        using var client = await f.Host();
        var campaign = f.Campaign.Id.ToString();
        var session = StoryJson.Object(await f.Transcript.StartSessionAsync(campaign, f.Gm.Id.ToString(), new("Table", "Dawn", Guid.NewGuid().ToString())));
        var unknown = Guid.NewGuid().ToString();
        foreach (var path in new[] { $"/campaigns/{campaign}/transcript/sessions", $"/campaigns/{campaign}/transcript/sessions/{session.Text("id")}/events", $"/campaigns/{campaign}/transcript/audio/{unknown}", $"/campaigns/{campaign}/visuals/library", $"/campaigns/{campaign}/visuals/sets", $"/campaigns/{campaign}/visuals/queue", $"/campaigns/{campaign}/visuals/candidates/{unknown}/image", $"/campaigns/{campaign}/music/playback", $"/campaigns/{campaign}/music/status" })
        {
            using var player = await f.PublicRequest(path, actor: f.Player);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(player)).StatusCode);
            using var outsider = await f.PublicRequest(path, actor: f.Outsider);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(outsider)).StatusCode);
        }
        var tokenPath = $"/campaigns/{campaign}/music/browser-player";
        using (var player = await f.PublicRequest(tokenPath, "POST", "{}", f.Player)) Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(player)).StatusCode);
        using (var outsider = await f.PublicRequest(tokenPath, "POST", "{}", f.Outsider)) Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(outsider)).StatusCode);
    }

    [Fact]
    public async Task TerminalTranscriptFailureDoesNotBlockTheNextChunk()
    {
        await using var f = await Fixture.Create();
        var campaign = f.Campaign.Id.ToString();
        var session = StoryJson.Object(await f.Transcript.StartSessionAsync(campaign, f.Gm.Id.ToString(), new("Table", "Dawn", Guid.NewGuid().ToString())));
        var first = Guid.NewGuid().ToString();
        var audio = Convert.ToBase64String(Enumerable.Repeat((byte)7, 64).ToArray());
        await f.Transcript.AddAudioAsync(campaign, session.Text("id"), f.Gm.Id.ToString(), new(audio, "audio/webm", 1000, first));
        for (var attempt = 0; attempt < 5; attempt++) { await f.Transcript.ProcessPendingOnceAsync(); f.Clock.Now = f.Clock.Now.AddMinutes(10); }
        var failed = f.Entities.Snapshot().Single(value => value.TypeSlug == "storyboard-transcript-job" && value.Data.Text("source_event") == first);
        Assert.Equal("failed", failed.Data.Text("state"));

        f.Compute.Status = new ComputeStatus([new("stt", "STT", "Running", "fixture"), new("diarization", "Diarization", "Running", "fixture")]);
        f.Compute.InlineResults["stt"] = new Queue<JsonObject>([new() { ["segments"] = new JsonArray() }]);
        f.Compute.InlineResults["diarization"] = new Queue<JsonObject>([new() { ["turns"] = new JsonArray() }, new() { ["turns"] = new JsonArray() }]);
        var second = Guid.NewGuid().ToString();
        await f.Transcript.AddAudioAsync(campaign, session.Text("id"), f.Gm.Id.ToString(), new(audio, "audio/webm", 1000, second));
        await f.Transcript.ProcessPendingOnceAsync();
        var completed = f.Entities.Snapshot().Single(value => value.TypeSlug == "storyboard-transcript-job" && value.Data.Text("source_event") == second);
        Assert.Equal("completed", completed.Data.Text("state"));
        var retryOperation = Guid.NewGuid().ToString();
        var retried = StoryJson.Object(await f.Transcript.RetryJobAsync(campaign, session.Text("id"), first, f.Gm.Id.ToString(), new(retryOperation)));
        Assert.Equal("pending", retried.Text("state"));
        Assert.Equal(0, retried.Number("attempts"));
        Assert.Equal("pending", StoryJson.Object(await f.Transcript.RetryJobAsync(campaign, session.Text("id"), first, f.Gm.Id.ToString(), new(retryOperation))).Text("state"));
    }
}
