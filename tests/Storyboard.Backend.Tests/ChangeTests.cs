using Leaf.Plugins.Storyboard;
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
}
