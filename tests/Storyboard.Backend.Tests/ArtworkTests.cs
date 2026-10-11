using System.Text.Json.Nodes;
using Leaf.Plugins.Storyboard;
using Leaf.Sdk.Services;
using Xunit;

namespace Storyboard.Testing;

public sealed class ArtworkTests
{
    [Fact]
    public async Task AgentArtworkRefinesEditablePromptAndProducesSelectableCandidates()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var account = fixture.Gm.Id.ToString();
        fixture.Compute.NextText = new AiCompletion(
            "{\"title\":\"Keeper of impossible stars\",\"prompt\":\"A watchful occult astronomer with ember-lit eyes, practical field coat, painterly fantasy portrait.\",\"negativePrompt\":\"lettering, watermark\"}",
            "fixture", Guid.NewGuid().ToString());

        var brief = StoryJson.Object(await fixture.Visuals.ArtworkBriefAsync(campaign, account,
            new ArtworkBriefWrite("agent", null, null, "A watchful guide to impossible stars.", 3), default));

        Assert.Equal("A watchful guide to impossible stars.", brief.Text("prompt"));
        Assert.Contains("occult astronomer", brief.Text("refinedPrompt"));
        Assert.Equal("fast", fixture.Compute.Requests.Single().QualityMode);
        Assert.Contains("Campaign Agent portrait", fixture.Compute.Requests.Single().Prompt);

        var operation = Guid.NewGuid().ToString();
        var started = StoryJson.Object(await fixture.Visuals.StartArtworkGenerationAsync(campaign, account,
            new ArtworkGenerationWrite(operation, "agent", null, null, brief.Text("prompt"),
                "A warm, watchful astronomer with ember-lit eyes, painterly fantasy portrait.",
                brief.Text("negativePrompt"), brief.Text("title"), 3, true), default));
        var entity = (await fixture.Entities.GetAsync(StoryJson.Id(started.Text("id"))))!;
        await fixture.Visuals.RunGenerationAsync(entity, default);
        var completed = StoryJson.Object(await fixture.Visuals.ArtworkGenerationAsync(campaign, account, started.Text("id"), default));

        Assert.Equal("completed", completed.Text("state"));
        Assert.Equal("agent", completed.Text("targetKind"));
        Assert.Equal("A warm, watchful astronomer with ember-lit eyes, painterly fantasy portrait.", completed.Text("refinedPrompt"));
        Assert.Equal(3, completed["candidates"]!.AsArray().Count);
        Assert.All(completed["candidates"]!.AsArray(), value => Assert.Equal("fixture-cover.png", value!.AsObject().Text("assetId")));
        Assert.Equal(3, fixture.Compute.Submissions);
        Assert.All(fixture.Compute.Submitted, submission =>
        {
            Assert.Equal(1024, submission.Inputs.Number("width"));
            Assert.Equal(1024, submission.Inputs.Number("height"));
            Assert.Contains("Avoid: lettering, watermark", submission.Inputs.Text("prompt"));
        });

        Assert.All(completed["candidates"]!.AsArray(), value =>
            Assert.StartsWith($"/api/campaigns/{campaign}/visuals/candidates/", value!.AsObject().Text("imageUrl")));
    }

    [Fact]
    public async Task EntityArtworkUsesOnlyDeclaredImageFieldsInsideTheCampaignWorkspace()
    {
        await using var fixture = await Fixture.Create();
        var campaignEntity = (await fixture.Entities.GetAsync(fixture.Campaign.Id))!;
        var root = (await fixture.Entities.GetAsync(StoryJson.Id(campaignEntity.Data.Text("workspace"))))!;
        await fixture.Entities.UpsertBySlugAsync("entity-type", "fixture-location-art", "Location", new()
        {
            ["scope"] = root.Slug,
            ["description"] = "Campaign locations"
        });
        await fixture.Entities.UpsertBySlugAsync("field-definition", "fixture-location-art--description", "Description", new()
        {
            ["parent_type"] = "fixture-location-art", ["field_type"] = "markdown", ["sort_order"] = 1
        });
        await fixture.Entities.UpsertBySlugAsync("field-definition", "fixture-location-art--image", "Image", new()
        {
            ["parent_type"] = "fixture-location-art", ["field_type"] = "image", ["sort_order"] = 2
        });
        var place = await fixture.Entities.UpsertBySlugAsync("fixture-location-art", "glass-observatory-art", "Glass Observatory", new()
        {
            ["parent"] = root.Id.ToString(), ["description"] = "A brass observatory above the cloud line."
        });
        fixture.Compute.NextText = new AiCompletion(
            "{\"title\":\"Glass Observatory\",\"prompt\":\"A brass observatory above a luminous cloud sea, impossible constellations, cinematic painterly fantasy environment.\",\"negativePrompt\":\"lettering\"}",
            "fixture", Guid.NewGuid().ToString());

        var brief = StoryJson.Object(await fixture.Visuals.ArtworkBriefAsync(
            fixture.Campaign.Id.ToString(), fixture.Gm.Id.ToString(),
            new ArtworkBriefWrite("entity", place.Id.ToString(), "image", "Impossible constellations over brass domes.", 3), default));

        Assert.Equal(place.Id.ToString(), brief.Text("entityId"));
        Assert.Equal("image", brief.Text("field"));
        Assert.Contains("Glass Observatory", fixture.Compute.Requests.Single().Prompt);
        await fixture.Entities.PatchAsync(place.Id, new JsonObject { ["image"] = "fixture-cover.png" });
        var media = await fixture.Visuals.WorkspaceArtworkMediaAsync(
            fixture.Campaign.Id.ToString(), fixture.Gm.Id.ToString(), place.Id.ToString(), "image", default);
        Assert.NotNull(media);
        Assert.Equal("image/png", media.Value.ContentType);
        var wrongField = await Assert.ThrowsAsync<StoryException>(() => fixture.Visuals.ArtworkBriefAsync(
            fixture.Campaign.Id.ToString(), fixture.Gm.Id.ToString(),
            new ArtworkBriefWrite("entity", place.Id.ToString(), "description", "Paint it.", 3), default));
        Assert.Equal("workspace_image_field_unavailable", wrongField.Code);
        var denied = await Assert.ThrowsAsync<StoryException>(() => fixture.Visuals.ArtworkBriefAsync(
            fixture.Campaign.Id.ToString(), fixture.Player.Id.ToString(),
            new ArtworkBriefWrite("entity", place.Id.ToString(), "image", "Paint it.", 3), default));
        Assert.Equal("game_master_required", denied.Code);
    }
}
