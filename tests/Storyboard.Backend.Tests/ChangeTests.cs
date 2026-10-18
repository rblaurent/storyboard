using Leaf.Plugins.Storyboard;
using Leaf.Sdk.Services;
using System.Text.Json.Nodes;
using Xunit;

namespace Storyboard.Testing;

public sealed class ChangeTests
{
    [Fact]
    public async Task BumpWakesHeldRequest()
    {
        var changes = new StoryChanges();
        var first = await changes.WaitAsync("campaign", "gm", true, null, default);
        var held = changes.WaitAsync("campaign", "gm", true, first.Token, default);

        changes.Bump("campaign", "visuals");

        var result = await held.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(["visuals"], result.Topics);
        Assert.NotEqual(first.Token, result.Token);
    }

    [Fact]
    public async Task PlayerCannotObserveGmOnlyTopic()
    {
        var changes = new StoryChanges();
        var first = await changes.WaitAsync("campaign", "player-one", false, null, default);
        Assert.DoesNotContain("cockpit", first.Topics);
        Assert.DoesNotContain("transcript", first.Topics);
        var held = changes.WaitAsync("campaign", "player-one", false, first.Token, default);

        changes.Bump("campaign", "cockpit");
        Assert.NotSame(held, await Task.WhenAny(held, Task.Delay(100)));
        changes.Bump("campaign", "journal:player-one");

        var result = await held.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(["journal:player-one"], result.Topics);
        Assert.DoesNotContain("cockpit", result.Topics);
    }

    [Fact]
    public async Task NewProcessEpochForcesFullVisibleRefetch()
    {
        var beforeRestart = new StoryChanges();
        var token = (await beforeRestart.WaitAsync("campaign", "player-one", false, null, default)).Token;

        var afterRestart = new StoryChanges();
        var result = await afterRestart.WaitAsync("campaign", "player-one", false, token, default);

        Assert.Equal(["visuals", "music", "players", "play-mode", "journal:player-one"], result.Topics);
    }

    [Fact]
    public async Task AgentVisualShowWakesGmAndPlayerWhileBackgroundLibraryCompletionIsGmOnly()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var gm = await fixture.Campaigns.MembershipAsync(campaign, fixture.Gm.Id.ToString());
        var player = await fixture.Campaigns.MembershipAsync(campaign, fixture.Player.Id.ToString());
        var visualData = await fixture.Store.ProtectAsync(new JsonObject { ["campaign"] = campaign, ["image_asset"] = "agent-show.png", ["active"] = true });
        var visual = await fixture.Store.ChangeAsync("storyboard-visual", "agent-show", "Agent show", _ => visualData);
        var gmToken = (await fixture.Changes.WaitAsync(campaign, gm.Id.ToString(), true, null, default)).Token;
        var playerToken = (await fixture.Changes.WaitAsync(campaign, player.Id.ToString(), false, null, default)).Token;
        var gmHeld = fixture.Changes.WaitAsync(campaign, gm.Id.ToString(), true, gmToken, default);
        var playerHeld = fixture.Changes.WaitAsync(campaign, player.Id.ToString(), false, playerToken, default);

        await fixture.Visuals.ShowAsync(campaign, fixture.Gm.Id.ToString(), new(visual.Id.ToString(), Guid.NewGuid().ToString()), default);

        Assert.Equal(["visuals"], (await gmHeld.WaitAsync(TimeSpan.FromSeconds(1))).Topics);
        Assert.Equal(["visuals"], (await playerHeld.WaitAsync(TimeSpan.FromSeconds(1))).Topics);

        var started = StoryJson.Object(await fixture.Visuals.StartGenerationAsync(campaign, fixture.Gm.Id.ToString(), new(
            Guid.NewGuid().ToString(), "A background library image",
            new VisualBriefWrite("Library", "crossfade", 20, [new("Library frame", "A quiet glass tower", "still", ["tower"])]), true), default));
        var generation = await fixture.Store.RequireAsync("storyboard-visual-generation", started.Text("id"));
        gmToken = (await fixture.Changes.WaitAsync(campaign, gm.Id.ToString(), true, null, default)).Token;
        playerToken = (await fixture.Changes.WaitAsync(campaign, player.Id.ToString(), false, null, default)).Token;
        gmHeld = fixture.Changes.WaitAsync(campaign, gm.Id.ToString(), true, gmToken, default);
        using var playerWait = new CancellationTokenSource();
        playerHeld = fixture.Changes.WaitAsync(campaign, player.Id.ToString(), false, playerToken, playerWait.Token);

        await fixture.Visuals.RunGenerationAsync(generation, default);

        Assert.Equal(["visuals"], (await gmHeld.WaitAsync(TimeSpan.FromSeconds(1))).Topics);
        Assert.NotSame(playerHeld, await Task.WhenAny(playerHeld, Task.Delay(100)));
        playerWait.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await playerHeld);
    }

    [Fact]
    public async Task AcceptedRevealProposalWakesOnlySelectedPlayerJournal()
    {
        await using var fixture = await Fixture.Create();
        var campaign = await fixture.Store.RequireAsync("storyboard-campaign", fixture.Campaign.Id.ToString());
        var root = (await fixture.Entities.GetAsync(StoryJson.Id(campaign.Data.Text("workspace"))))!;
        await fixture.Entities.UpsertBySlugAsync("entity-type", "fixture-reveal", "Reveal", new() { ["scope"] = root.Slug });
        var entity = await fixture.Entities.UpsertBySlugAsync("fixture-reveal", "selected-reveal", "Selected reveal", new() { ["parent"] = root.Id.ToString() });
        await fixture.Workspace.SavePlayerViewAsync(campaign.Id.ToString(), fixture.Gm.Id.ToString(), entity.Id.ToString(), new("Selected reveal", "Only one player receives this.", null, [], entity.UpdatedAt.ToString("O"), Guid.NewGuid().ToString()));
        var secondAccount = await fixture.Access.AccountAsync("fixture:second-player", "second@example.invalid", "Second player", "");
        await fixture.Campaigns.SetMemberAsync(campaign.Id.ToString(), fixture.Gm.Id.ToString(), new(secondAccount.Id.ToString(), "player"));
        var selected = await fixture.Campaigns.MembershipAsync(campaign.Id.ToString(), fixture.Player.Id.ToString());
        var other = await fixture.Campaigns.MembershipAsync(campaign.Id.ToString(), secondAccount.Id.ToString());
        var suggestionData = await fixture.Store.ProtectAsync(new JsonObject { ["campaign"] = campaign.Id.ToString(), ["state"] = "proposed", ["entity"] = entity.Id.ToString(), ["action"] = "reveal" });
        var suggestion = await fixture.Store.ChangeAsync("storyboard-cockpit-suggestion", "selected-reveal-proposal", "Reveal it", _ => suggestionData);
        var selectedToken = (await fixture.Changes.WaitAsync(campaign.Id.ToString(), selected.Id.ToString(), false, null, default)).Token;
        var otherToken = (await fixture.Changes.WaitAsync(campaign.Id.ToString(), other.Id.ToString(), false, null, default)).Token;
        var selectedHeld = fixture.Changes.WaitAsync(campaign.Id.ToString(), selected.Id.ToString(), false, selectedToken, default);
        using var otherWait = new CancellationTokenSource();
        var otherHeld = fixture.Changes.WaitAsync(campaign.Id.ToString(), other.Id.ToString(), false, otherToken, otherWait.Token);

        await fixture.Cockpit.DecideAsync(campaign.Id.ToString(), suggestion.Id.ToString(), fixture.Gm.Id.ToString(), new("accept", Guid.NewGuid().ToString(), false, [selected.Id.ToString()]), default);

        Assert.Equal(["journal:" + selected.Id], (await selectedHeld.WaitAsync(TimeSpan.FromSeconds(1))).Topics);
        Assert.NotSame(otherHeld, await Task.WhenAny(otherHeld, Task.Delay(100)));
        otherWait.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await otherHeld);
    }

    [Fact]
    public async Task TranscriptJobResultWakesGmOnly()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var session = StoryJson.Object(await fixture.Transcript.StartSessionAsync(campaign, fixture.Gm.Id.ToString(), new("Recorded", "Dawn", Guid.NewGuid().ToString())));
        fixture.Compute.Status = new ComputeStatus([new("stt", "STT", "Running", "fixture"), new("diarization", "Diarization", "Running", "fixture")]);
        fixture.Compute.InlineResults["stt"] = new Queue<JsonObject>([new() { ["segments"] = new JsonArray() }]);
        fixture.Compute.InlineResults["diarization"] = new Queue<JsonObject>([new() { ["turns"] = new JsonArray() }, new() { ["turns"] = new JsonArray() }]);
        await fixture.Transcript.AddAudioAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new(Convert.ToBase64String(Enumerable.Repeat((byte)7, 64).ToArray()), "audio/webm", 1000, Guid.NewGuid().ToString()));
        var gm = await fixture.Campaigns.MembershipAsync(campaign, fixture.Gm.Id.ToString());
        var player = await fixture.Campaigns.MembershipAsync(campaign, fixture.Player.Id.ToString());
        var gmToken = (await fixture.Changes.WaitAsync(campaign, gm.Id.ToString(), true, null, default)).Token;
        var playerToken = (await fixture.Changes.WaitAsync(campaign, player.Id.ToString(), false, null, default)).Token;
        var gmHeld = fixture.Changes.WaitAsync(campaign, gm.Id.ToString(), true, gmToken, default);
        using var playerWait = new CancellationTokenSource();
        var playerHeld = fixture.Changes.WaitAsync(campaign, player.Id.ToString(), false, playerToken, playerWait.Token);

        await fixture.Transcript.ProcessPendingOnceAsync();

        Assert.Equal(["transcript"], (await gmHeld.WaitAsync(TimeSpan.FromSeconds(1))).Topics);
        Assert.NotSame(playerHeld, await Task.WhenAny(playerHeld, Task.Delay(100)));
        playerWait.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await playerHeld);
    }
}
