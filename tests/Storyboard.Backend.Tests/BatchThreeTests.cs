using System.Net;
using System.Text.Json.Nodes;
using Leaf.Plugins.Storyboard;
using Leaf.Sdk.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Storyboard.Testing;
using Xunit;

namespace Storyboard.Backend.Tests;

public sealed class BatchThreeTests
{
    [Fact]
    public async Task EpisodesAreSequentialEndingQueuesRecapAndNeverMovesNowCards()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var root = (await fixture.Entities.GetAsync(StoryJson.Id(fixture.Campaign.Data.Text("workspace"))))!;
        await fixture.Entities.UpsertBySlugAsync("entity-type", "fixture-beat", "Beat", new JsonObject { ["scope"] = root.Slug });
        var beat = await fixture.Entities.UpsertBySlugAsync("fixture-beat", "fixture-now", "Still happening", new JsonObject { ["parent"] = root.Id.ToString(), ["description"] = "Do not move automatically." });
        await fixture.Cockpit.PinAsync(campaign, fixture.Gm.Id.ToString(), new(beat.Id.ToString(), "now", Guid.NewGuid().ToString()));

        var first = StoryJson.Object(await fixture.Transcript.StartSessionAsync(campaign, fixture.Gm.Id.ToString(), new("First", "Dawn", Guid.NewGuid().ToString())));
        Assert.Equal(1, first.Number("episodeNumber"));
        await fixture.Transcript.EndSessionAsync(campaign, first.Text("id"), fixture.Gm.Id.ToString(), new(Guid.NewGuid().ToString()));
        Assert.Single(fixture.Entities.Snapshot().Where(value => value.TypeSlug == "storyboard-session-recap"));
        Assert.Equal("now", Assert.Single(fixture.Entities.Snapshot().Where(value => value.TypeSlug == "storyboard-cockpit-item")).Data.Text("phase"));

        var second = StoryJson.Object(await fixture.Transcript.StartSessionAsync(campaign, fixture.Gm.Id.ToString(), new("Second", "Noon", Guid.NewGuid().ToString())));
        Assert.Equal(2, second.Number("episodeNumber"));
    }

    [Fact]
    public async Task RecapGroundingAndPlayerPromptEnforcePrivacyBoundary()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var root = (await fixture.Entities.GetAsync(StoryJson.Id(fixture.Campaign.Data.Text("workspace"))))!;
        await fixture.Entities.UpsertBySlugAsync("entity-type", "fixture-secret-npc", "NPC", new JsonObject { ["scope"] = root.Slug });
        await fixture.Entities.UpsertBySlugAsync("field-definition", "fixture-secret-npc--secret", "Secret", new JsonObject { ["parent_type"] = "fixture-secret-npc", ["field_type"] = "secret", ["sort_order"] = 2 });
        var npc = await fixture.Entities.UpsertBySlugAsync("fixture-secret-npc", "hidden-npc", "Hidden NPC", new JsonObject { ["parent"] = root.Id.ToString(), ["description"] = "A public description", ["secret"] = "BLACK ORCHID PASSWORD" });
        await fixture.Workspace.SavePlayerViewAsync(campaign, fixture.Gm.Id.ToString(), npc.Id.ToString(), new("Known NPC", "A public description", null, ["description"], npc.UpdatedAt.ToString("O"), Guid.NewGuid().ToString()));
        var membership = await fixture.Campaigns.MembershipAsync(campaign, fixture.Player.Id.ToString());
        await fixture.Visibility.SetAsync(campaign, fixture.Gm.Id.ToString(), npc.Id.ToString(), new(false, [membership.Id.ToString()], true, Guid.NewGuid().ToString()));

        var session = StoryJson.Object(await fixture.Transcript.StartSessionAsync(campaign, fixture.Gm.Id.ToString(), new("Secrets", "Night", Guid.NewGuid().ToString())));
        var noteId = Guid.NewGuid().ToString();
        var speechId = Guid.NewGuid().ToString();
        await fixture.Transcript.AddEventAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new("note", "meta", "The GM note says SILVER CIPHER", new("gm", "GM"), noteId));
        await fixture.Transcript.AddEventAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new("speech", "roleplay", "We should search the old observatory.", new("player", "Player"), speechId));
        await fixture.Transcript.EndSessionAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new(Guid.NewGuid().ToString()));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{\"summary\":\"mapped\"}", "fixture-map", "map-job"));
        fixture.Compute.TextResults.Enqueue(new AiCompletion(new JsonObject
        {
            ["gmNarrative"] = "A grounded GM recap.",
            ["keyMoments"] = new JsonArray(new JsonObject { ["text"] = "Fabricated", ["citations"] = new JsonArray(speechId, "fabricated-event") }),
            ["proposals"] = new JsonArray(new JsonObject { ["kind"] = "patch", ["targetEntity"] = Guid.NewGuid().ToString(), ["name"] = "Outside", ["data"] = new JsonObject(), ["rationale"] = "Invalid target", ["citations"] = new JsonArray(speechId) }),
            ["threads"] = new JsonArray(new JsonObject { ["text"] = "Search the observatory", ["citations"] = new JsonArray(speechId), ["entityIds"] = new JsonArray(npc.Id.ToString(), Guid.NewGuid().ToString()) }),
            ["prep"] = new JsonArray(),
        }.ToJsonString(), "fixture-reduce", "reduce-job"));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{\"playerRecap\":\"The party searched. SILVER CIPHER and BLACK ORCHID PASSWORD\"}", "fixture-player", "player-job"));

        await fixture.Recaps.ProcessPendingOnceAsync();
        var recap = StoryJson.Object((await fixture.Recaps.GetAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString()))!);
        Assert.Equal("completed", recap.Text("state"));
        Assert.Empty(recap["keyMoments"]!.AsArray());
        Assert.Empty(recap["proposals"]!.AsArray());
        Assert.Single(recap["threads"]!.AsArray()[0]!["entityIds"]!.AsArray());
        Assert.DoesNotContain("SILVER CIPHER", recap.Text("playerDraft"), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("BLACK ORCHID PASSWORD", recap.Text("playerDraft"), StringComparison.OrdinalIgnoreCase);
        var playerPrompt = fixture.Compute.Requests.Single(value => value.IdempotencyKey!.EndsWith("-player", StringComparison.Ordinal)).Prompt;
        Assert.Contains("old observatory", playerPrompt);
        Assert.Contains("A public description", playerPrompt);
        Assert.DoesNotContain("SILVER CIPHER", playerPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("BLACK ORCHID PASSWORD", playerPrompt, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("GM note", playerPrompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RecapJobResumesFromSavedMapWithoutDuplicateEntity()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var session = StoryJson.Object(await fixture.Transcript.StartSessionAsync(campaign, fixture.Gm.Id.ToString(), new("Restart", "Dawn", Guid.NewGuid().ToString())));
        var eventId = Guid.NewGuid().ToString();
        await fixture.Transcript.AddEventAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new("speech", "roleplay", new string('A', 7900), new("table", "Table"), eventId));
        await fixture.Transcript.EndSessionAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new(Guid.NewGuid().ToString()));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{\"summary\":\"mapped\"}", "fixture", "map-job"));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{\"gmNarrative\":\"Recovered\",\"keyMoments\":[],\"proposals\":[],\"threads\":[],\"prep\":[]}", "fixture", "reduce-job"));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{\"playerRecap\":\"Recovered safely\"}", "fixture", "player-job"));
        var calls = 0;
        fixture.Compute.DuringText = () => ++calls == 2 ? Task.FromException(new InvalidOperationException("simulated restart")) : Task.CompletedTask;
        await fixture.Recaps.ProcessPendingOnceAsync();
        fixture.Compute.DuringText = null;
        using var restarted = new StorySessionRecaps(fixture.Store, fixture.Campaigns, fixture.Workspace, fixture.Visibility, fixture.Ledger, fixture.Compute, fixture.Changes, fixture.Clock, NullLogger<StorySessionRecaps>.Instance);
        await restarted.ProcessPendingOnceAsync();

        Assert.Single(fixture.Entities.Snapshot().Where(value => value.TypeSlug == "storyboard-session-recap"));
        Assert.Single(fixture.Compute.Requests.Where(value => value.IdempotencyKey!.Contains("-map-0", StringComparison.Ordinal)));
        var recap = StoryJson.Object((await restarted.GetAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString()))!);
        Assert.Equal("completed", recap.Text("state"));
    }

    [Fact]
    public async Task ConflictStaysOpenPublishRevealsSelectedPlayersAndRoutesAreGmOnly()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var secondAccount = await fixture.Access.AccountAsync("fixture:second", "second@example.invalid", "Second", "");
        await fixture.Campaigns.SetMemberAsync(campaign, fixture.Gm.Id.ToString(), new(secondAccount.Id.ToString(), "player"));
        var second = await fixture.Campaigns.MembershipAsync(campaign, secondAccount.Id.ToString());
        var selected = await fixture.Campaigns.MembershipAsync(campaign, fixture.Player.Id.ToString());
        var root = (await fixture.Entities.GetAsync(StoryJson.Id(fixture.Campaign.Data.Text("workspace"))))!;
        await fixture.Entities.UpsertBySlugAsync("entity-type", "fixture-place", "Place", new JsonObject { ["scope"] = root.Slug });
        var place = await fixture.Entities.UpsertBySlugAsync("fixture-place", "old-tower", "Old tower", new JsonObject { ["parent"] = root.Id.ToString(), ["description"] = "Before" });
        var session = StoryJson.Object(await fixture.Transcript.StartSessionAsync(campaign, fixture.Gm.Id.ToString(), new("Review", "Dawn", Guid.NewGuid().ToString())));
        var eventId = Guid.NewGuid().ToString();
        await fixture.Transcript.AddEventAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new("speech", "roleplay", "The tower fell.", new("table", "Table"), eventId));
        await fixture.Transcript.EndSessionAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new(Guid.NewGuid().ToString()));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{}", "fixture", "map"));
        fixture.Compute.TextResults.Enqueue(new AiCompletion(new JsonObject { ["gmNarrative"] = "The tower fell.", ["keyMoments"] = new JsonArray(), ["proposals"] = new JsonArray(new JsonObject { ["kind"] = "patch", ["targetEntity"] = place.Id.ToString(), ["name"] = "Old tower", ["data"] = new JsonObject { ["description"] = "Ruined" }, ["rationale"] = "It fell", ["citations"] = new JsonArray(eventId) }), ["threads"] = new JsonArray(), ["prep"] = new JsonArray() }.ToJsonString(), "fixture", "reduce"));
        fixture.Compute.TextResults.Enqueue(new AiCompletion("{\"playerRecap\":\"The tower fell.\"}", "fixture", "player"));
        await fixture.Recaps.ProcessPendingOnceAsync();
        var generated = StoryJson.Object((await fixture.Recaps.GetAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString()))!);
        Assert.True(generated["proposals"]!.AsArray().Count == 1, fixture.Entities.Snapshot().Single(value => value.TypeSlug == "storyboard-session-recap").Data.ToJsonString());
        place = await fixture.Entities.PatchAsync(place.Id, new JsonObject { ["description"] = "Changed after generation" });
        var conflicted = StoryJson.Object(await fixture.Recaps.DecideProposalAsync(campaign, session.Text("id"), 0, fixture.Gm.Id.ToString(), new("accept", Guid.NewGuid().ToString(), "Old tower", new JsonObject { ["description"] = "Ruined" })));
        var proposal = conflicted["proposals"]![0]!.AsObject();
        Assert.Equal("proposed", proposal.Text("state"));
        Assert.NotNull(proposal["conflict"]);

        var baseline = (await fixture.Changes.WaitAsync(campaign, selected.Id.ToString(), false, null, default)).Token;
        var otherBaseline = (await fixture.Changes.WaitAsync(campaign, second.Id.ToString(), false, null, default)).Token;
        using var otherCancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        var selectedWait = fixture.Changes.WaitAsync(campaign, selected.Id.ToString(), false, baseline, default);
        var otherWait = fixture.Changes.WaitAsync(campaign, second.Id.ToString(), false, otherBaseline, otherCancellation.Token);
        await fixture.Recaps.PublishAsync(campaign, session.Text("id"), fixture.Gm.Id.ToString(), new("The tower fell.", false, [selected.Id.ToString()], Guid.NewGuid().ToString()));
        Assert.Contains("journal:" + selected.Id, (await selectedWait).Topics);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await otherWait);
        var journal = StoryJson.Object(await fixture.Visibility.JournalAsync(campaign, fixture.Player.Id.ToString()));
        Assert.Contains(journal["items"]!.AsArray(), value => value!.AsObject().Text("description") == "The tower fell.");

        using var client = await fixture.Host();
        using var playerRequest = await fixture.PublicRequest($"/campaigns/{campaign}/transcript/sessions/{session.Text("id")}/recap", actor: fixture.Player);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(playerRequest)).StatusCode);
        using var outsiderRequest = await fixture.PublicRequest($"/campaigns/{campaign}/transcript/sessions/{session.Text("id")}/recap", actor: fixture.Outsider);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(outsiderRequest)).StatusCode);
    }
}
