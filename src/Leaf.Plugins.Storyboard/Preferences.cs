using System.Text.Json.Nodes;

namespace Leaf.Plugins.Storyboard;

public sealed record LocaleWrite(string Locale);

public sealed class StoryPreferences(StoryStore store)
{
    public static string Normalize(string? locale) => locale?.Trim().ToLowerInvariant() switch
    {
        "fr" or "fr-fr" or "fr-ch" or "fr-ca" => "fr",
        _ => "en"
    };

    public async Task<object> SaveLocaleAsync(string accountId, LocaleWrite input, CancellationToken ct = default)
    {
        if (input is null || input.Locale?.Trim().ToLowerInvariant() is not ("en" or "fr" or "en-us" or "en-gb" or "fr-fr" or "fr-ch" or "fr-ca"))
            throw new StoryException("invalid_locale");
        var locale = Normalize(input.Locale);
        await store.Commands.WaitAsync(ct);
        try
        {
            await store.WritableAsync(ct);
            var account = await store.RequireAsync("storyboard-account", accountId, ct);
            var saved = await store.ChangeAsync(account.TypeSlug, account.Slug, account.Name, current =>
            {
                var next = current!.Data.DeepClone().AsObject();
                next["preferred_locale"] = locale;
                return next;
            }, ct);
            await store.AuditAsync("account.locale.updated", accountId, accountId, new JsonObject { ["locale"] = locale }, ct);
            return new { locale = Normalize(saved.Data.Text("preferred_locale")) };
        }
        finally { store.Commands.Release(); }
    }
}
