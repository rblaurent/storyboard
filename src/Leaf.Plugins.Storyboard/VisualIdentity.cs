using System.Text.Json.Nodes;
using Leaf.Sdk;

namespace Leaf.Plugins.Storyboard;

public sealed record VisualProfileWrite(
    string ArtDirection,
    string NegativePrompt,
    int DefaultIntervalSeconds,
    string Transition,
    string? PortraitDirection = null,
    string? SceneDirection = null,
    string? DefaultWorkflow = null,
    string? PortraitWorkflow = null,
    string? SceneWorkflow = null);

public sealed record VisualProfileRefineWrite(string? Direction);

public sealed record StoryVisualProfile(
    string ArtDirection,
    string PortraitDirection,
    string SceneDirection,
    string NegativePrompt,
    int DefaultIntervalSeconds,
    string Transition,
    string DefaultWorkflow,
    string PortraitWorkflow,
    string SceneWorkflow,
    bool Configured);

public sealed class StoryVisualIdentity(StoryStore store)
{
    private static readonly HashSet<string> SupportedRequiredInputs = new(StringComparer.OrdinalIgnoreCase)
    {
        "prompt", "negative_prompt", "seed", "width", "height", "steps", "cfg"
    };

    public async Task<StoryVisualProfile> GetAsync(string campaign, CancellationToken ct)
    {
        var existing = await store.Entities.GetBySlugAsync("storyboard-visual-profile", "visual-profile-" + campaign, ct);
        if (existing is not null)
        {
            await store.CheckProtectionAsync(existing, ct);
            if (existing.Data.Text("campaign") == campaign) return FromEntity(existing, true);
        }

        var config = (await store.ConfigAsync(ct))!;
        return new StoryVisualProfile(
            config.Data.Text("visual_brief", "Cinematic campaign artwork, clear composition, no lettering."),
            "Character-focused composition with a readable face, natural expression and coherent clothing.",
            "Environment-focused composition with strong depth, atmosphere and a clear focal point.",
            "lettering, captions, interface, watermark",
            30,
            "crossfade",
            "",
            "",
            "",
            false);
    }

    public object Projection(StoryVisualProfile profile) => new
    {
        artDirection = profile.ArtDirection,
        portraitDirection = profile.PortraitDirection,
        sceneDirection = profile.SceneDirection,
        negativePrompt = profile.NegativePrompt,
        defaultIntervalSeconds = profile.DefaultIntervalSeconds,
        transition = profile.Transition,
        defaultWorkflow = profile.DefaultWorkflow,
        portraitWorkflow = profile.PortraitWorkflow,
        sceneWorkflow = profile.SceneWorkflow,
        configured = profile.Configured
    };

    public JsonObject Snapshot(StoryVisualProfile profile) => new()
    {
        ["artDirection"] = profile.ArtDirection,
        ["portraitDirection"] = profile.PortraitDirection,
        ["sceneDirection"] = profile.SceneDirection,
        ["negativePrompt"] = profile.NegativePrompt,
        ["defaultIntervalSeconds"] = profile.DefaultIntervalSeconds,
        ["transition"] = profile.Transition,
        ["defaultWorkflow"] = profile.DefaultWorkflow,
        ["portraitWorkflow"] = profile.PortraitWorkflow,
        ["sceneWorkflow"] = profile.SceneWorkflow
    };

    public async Task<StoryVisualProfile> ValidateAsync(VisualProfileWrite input, CancellationToken ct)
    {
        if (input is null) throw new StoryException("invalid_visual_profile");
        var transition = StoryJson.Bounded(input.Transition, 20, true).ToLowerInvariant();
        if (transition is not "cut" and not "crossfade") throw new StoryException("invalid_visual_transition");
        return new StoryVisualProfile(
            StoryJson.Bounded(input.ArtDirection, 4000, true),
            StoryJson.Bounded(input.PortraitDirection ?? "", 3000),
            StoryJson.Bounded(input.SceneDirection ?? "", 3000),
            StoryJson.Bounded(input.NegativePrompt, 1200),
            Math.Clamp(input.DefaultIntervalSeconds, 5, 300),
            transition,
            await NormalizeWorkflowAsync(input.DefaultWorkflow, ct),
            await NormalizeWorkflowAsync(input.PortraitWorkflow, ct),
            await NormalizeWorkflowAsync(input.SceneWorkflow, ct),
            true);
    }

    public async Task<object> WorkflowOptionsAsync(CancellationToken ct)
    {
        var page = await store.Entities.QueryAsync(new EntityQuery { TypeSlug = "comfyui-workflow", Limit = 500 }, ct);
        var items = page.Where(IsCompatibleImageWorkflow)
            .OrderBy(workflow => workflow.Name, StringComparer.OrdinalIgnoreCase)
            .Select(workflow => new
            {
                id = workflow.Id,
                slug = workflow.Slug,
                name = workflow.Name,
                description = workflow.Data.Text("description"),
                license = workflow.Data.Text("license"),
                providerModel = workflow.Data.Text("provider_model")
            }).ToArray();
        var config = (await store.ConfigAsync(ct))!;
        var fallback = await ResolveWorkflowAsync(config.Data.Text("workflow"), ct);
        return new { defaultWorkflow = fallback.Slug, items };
    }

    public async Task<LeafEntity> ResolveForAsync(StoryVisualProfile profile, string role, CancellationToken ct)
    {
        var reference = role switch
        {
            "portrait" when profile.PortraitWorkflow != "" => profile.PortraitWorkflow,
            "scene" when profile.SceneWorkflow != "" => profile.SceneWorkflow,
            _ when profile.DefaultWorkflow != "" => profile.DefaultWorkflow,
            _ => (await store.ConfigAsync(ct))!.Data.Text("workflow")
        };
        return await ResolveWorkflowAsync(reference, ct);
    }

    public string StyleFor(StoryVisualProfile profile, string role)
    {
        var specialised = role == "portrait" ? profile.PortraitDirection : role == "scene" ? profile.SceneDirection : "";
        return string.IsNullOrWhiteSpace(specialised) ? profile.ArtDirection : profile.ArtDirection + "\n" + specialised;
    }

    public JsonObject InputsFor(LeafEntity workflow, int width, int height)
    {
        var parameters = workflow.Data["parameters"] as JsonArray ?? new JsonArray();
        var names = parameters.OfType<JsonObject>().Select(value => value.Text("name")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var inputs = new JsonObject();
        if (names.Contains("width")) inputs["width"] = width;
        if (names.Contains("height")) inputs["height"] = height;
        inputs["steps"] = ParameterNumber(parameters, "steps", 8);
        inputs["cfg"] = ParameterDecimal(parameters, "cfg", 1);
        if (names.Contains("negative_prompt")) inputs["negative_prompt"] = "";
        return inputs;
    }

    public static bool Supports(LeafEntity workflow, string parameter)
        => (workflow.Data["parameters"] as JsonArray)?.OfType<JsonObject>().Any(value => value.Text("name").Equals(parameter, StringComparison.OrdinalIgnoreCase)) == true;

    private async Task<string> NormalizeWorkflowAsync(string? reference, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(reference)) return "";
        return (await ResolveWorkflowAsync(reference, ct)).Slug;
    }

    private async Task<LeafEntity> ResolveWorkflowAsync(string reference, CancellationToken ct)
    {
        var workflow = Guid.TryParse(reference, out var id)
            ? await store.Entities.GetAsync(id, ct)
            : await store.Entities.GetBySlugAsync("comfyui-workflow", reference, ct);
        if (workflow is null || !IsCompatibleImageWorkflow(workflow)) throw new StoryException("workflow_not_available", 503);
        return workflow;
    }

    private static StoryVisualProfile FromEntity(LeafEntity entity, bool configured) => new(
        entity.Data.Text("art_direction"),
        entity.Data.Text("portrait_direction"),
        entity.Data.Text("scene_direction"),
        entity.Data.Text("negative_prompt"),
        (int)(entity.Data["default_interval_seconds"] is null ? 30 : entity.Data.Number("default_interval_seconds")),
        entity.Data.Text("transition", "crossfade"),
        entity.Data.Text("default_workflow"),
        entity.Data.Text("portrait_workflow"),
        entity.Data.Text("scene_workflow"),
        configured);

    private static bool IsCompatibleImageWorkflow(LeafEntity workflow)
    {
        if (workflow.TypeSlug != "comfyui-workflow" || workflow.Data.Text("media_type") != "image") return false;
        var parameters = workflow.Data["parameters"] as JsonArray;
        if (parameters is null) return false;
        var values = parameters.OfType<JsonObject>().ToArray();
        var names = values.Select(value => value.Text("name")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!new[] { "prompt", "seed", "width", "height", "steps", "cfg" }.All(names.Contains)) return false;
        return values.Where(value => value.Flag("required")).All(value => SupportedRequiredInputs.Contains(value.Text("name")));
    }

    private static long ParameterNumber(JsonArray parameters, string name, long fallback)
    {
        var parameter = parameters.OfType<JsonObject>().FirstOrDefault(value => value.Text("name").Equals(name, StringComparison.OrdinalIgnoreCase));
        return parameter?["default"] is null ? fallback : parameter.Number("default");
    }

    private static decimal ParameterDecimal(JsonArray parameters, string name, decimal fallback)
    {
        var parameter = parameters.OfType<JsonObject>().FirstOrDefault(value => value.Text("name").Equals(name, StringComparison.OrdinalIgnoreCase));
        return parameter?["default"] is null ? fallback : parameter.Decimal("default");
    }
}
