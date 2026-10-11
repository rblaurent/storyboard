using System.Text.Json.Nodes;
using Leaf.Plugins.Storyboard;
using Leaf.Sdk.Services;
using Xunit;

namespace Storyboard.Testing;

public sealed class ArtworkTests
{
    [Fact]
    public async Task CampaignVisualIdentityRefinesStyleAndSelectsCompatibleWorkflowEntitiesPerTarget()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var account = fixture.Gm.Id.ToString();
        await fixture.Entities.PatchAsync(fixture.Campaign.Id, new JsonObject
        {
            ["summary"] = "Veyra mourns Regent Amareth while the Ember Concord crosses Cael Rhyss."
        });
        fixture.Compute.NextText = new AiCompletion(
            "{\"artDirection\":\"Graphic painted fantasy concept art, dry mineral texture, oxidised copper accents and cool shadows.\",\"portraitDirection\":\"Expressive half-length studies with natural anatomy and practical layered clothing.\",\"sceneDirection\":\"Monumental civic environments with atmospheric depth and asymmetrical framing.\",\"negativePrompt\":\"lettering, watermark, glossy photography\"}",
            "fixture", Guid.NewGuid().ToString());

        var proposed = StoryJson.Object(await fixture.Visuals.RefineProfileAsync(campaign, account, new("Painterly civic fantasy."), default));
        Assert.Contains("dry mineral texture", proposed.Text("artDirection"));
        Assert.Contains("Never include proper nouns", fixture.Compute.Requests.Single().Prompt);
        Assert.Contains("Veyra", fixture.Compute.Requests.Single().Prompt);

        var saved = StoryJson.Object(await fixture.Visuals.SaveProfileAsync(campaign, account, new(
            proposed.Text("artDirection"), proposed.Text("negativePrompt"), 24, "crossfade",
            proposed.Text("portraitDirection"), proposed.Text("sceneDirection"), "z_turbo", "qwen_fixture", "z_turbo"), default));
        Assert.True(saved.Flag("configured"));
        Assert.Equal("qwen_fixture", saved.Text("portraitWorkflow"));
        var options = StoryJson.Object(await fixture.Visuals.WorkflowOptionsAsync(campaign, account, default));
        Assert.Equal(2, options["items"]!.AsArray().Count);

        fixture.Compute.NextText = new AiCompletion(
            "{\"title\":\"Campaign guide\",\"prompt\":\"A composed archivist, graphic painted fantasy portrait.\",\"negativePrompt\":\"lettering\"}",
            "fixture", Guid.NewGuid().ToString());
        await fixture.Visuals.ArtworkBriefAsync(campaign, account, new("agent", null, null, "A composed archivist.", 3), default);
        Assert.Contains("dry mineral texture", fixture.Compute.Requests.Last().Prompt);
        Assert.Contains("half-length studies", fixture.Compute.Requests.Last().Prompt);
        Assert.DoesNotContain("Monumental civic environments", fixture.Compute.Requests.Last().Prompt);

        var started = StoryJson.Object(await fixture.Visuals.StartArtworkGenerationAsync(campaign, account,
            new(Guid.NewGuid().ToString(), "agent", null, null, "A composed archivist.", "A composed archivist, graphic painted fantasy portrait.", "lettering", "Campaign guide", 1, true), default));
        var generation = (await fixture.Entities.GetAsync(StoryJson.Id(started.Text("id"))))!;
        Assert.Equal("qwen_fixture", generation.Data.Text("workflow"));
        Assert.Equal(40, generation.Data.Number("steps"));
        Assert.True(generation.Data["workflow_inputs"]!.AsObject().ContainsKey("negative_prompt"));
        await fixture.Visuals.RunGenerationAsync(generation, default);
        Assert.Equal("lettering", fixture.Compute.Submitted.Single().Inputs.Text("negative_prompt"));
        Assert.DoesNotContain("Avoid:", fixture.Compute.Submitted.Single().Inputs.Text("prompt"));
    }

    [Fact]
    public async Task AgentArtworkRefinesEditablePromptAndProducesSelectableCandidates()
    {
        await using var fixture = await Fixture.Create();
        var campaign = fixture.Campaign.Id.ToString();
        var account = fixture.Gm.Id.ToString();
        await fixture.Entities.PatchAsync(fixture.Campaign.Id, new JsonObject
        {
            ["summary"] = "Veyra mourns Amareth beneath the extinct furnaces of Cael Rhyss.",
            ["description"] = "The Ember Concord archives the Seven-Day Mourning.",
            ["agent_direction"] = "Carry a crystal lamp bearing the Concord sigil."
        });
        fixture.Compute.NextText = new AiCompletion(
            "{\"title\":\"Keeper of impossible stars\",\"prompt\":\"A watchful occult astronomer with ember-lit eyes, practical field coat, painterly fantasy portrait.\",\"negativePrompt\":\"lettering, watermark\"}",
            "fixture", Guid.NewGuid().ToString());

        var brief = StoryJson.Object(await fixture.Visuals.ArtworkBriefAsync(campaign, account,
            new ArtworkBriefWrite("agent", null, null, "A watchful guide to impossible stars.", 3), default));

        Assert.Equal("A watchful guide to impossible stars.", brief.Text("prompt"));
        Assert.Contains("occult astronomer", brief.Text("refinedPrompt"));
        Assert.Equal("fast", fixture.Compute.Requests.Single().QualityMode);
        Assert.Contains("Campaign Agent portrait", fixture.Compute.Requests.Single().Prompt);
        Assert.Contains("visual prompt editor, not a storyteller", fixture.Compute.Requests.Single().Prompt);
        Assert.DoesNotContain("Veyra", fixture.Compute.Requests.Single().Prompt);
        Assert.DoesNotContain("Amareth", fixture.Compute.Requests.Single().Prompt);
        Assert.DoesNotContain("Cael Rhyss", fixture.Compute.Requests.Single().Prompt);
        Assert.DoesNotContain("crystal lamp", fixture.Compute.Requests.Single().Prompt);

        var operation = Guid.NewGuid().ToString();
        var started = StoryJson.Object(await fixture.Visuals.StartArtworkGenerationAsync(campaign, account,
            new ArtworkGenerationWrite(operation, "agent", null, null, brief.Text("prompt"),
                "A warm, watchful astronomer with ember-lit eyes, painterly fantasy portrait.",
                brief.Text("negativePrompt"), brief.Text("title"), 3, true), default));
        var entity = (await fixture.Entities.GetAsync(StoryJson.Id(started.Text("id"))))!;
        var workflowInputs = entity.Data["workflow_inputs"]!.AsObject();
        Assert.Equal(1024, workflowInputs.Number("width"));
        Assert.Equal(1024, workflowInputs.Number("height"));
        Assert.Equal(8, workflowInputs.Number("steps"));
        Assert.Equal(1m, workflowInputs.Decimal("cfg"));
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
            Assert.DoesNotContain("Art direction:", submission.Inputs.Text("prompt"));
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
        Assert.DoesNotContain("Glass Observatory", fixture.Compute.Requests.Single().Prompt);
        Assert.DoesNotContain("A brass observatory above the cloud line", fixture.Compute.Requests.Single().Prompt);
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
