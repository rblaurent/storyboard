using Leaf.Plugins.Storyboard;
using System.Text.Json.Nodes;
using Xunit;
namespace Storyboard.Testing;
// The kernel refuses to boot (outside dev mode) when a registered IFlowNodeHandler has
// no seeded node-type entity, so every flow-node handler the plugin registers needs one.
public sealed class SeedContractTests {
 // stage.ps1 builds into a scratch artifacts path, so resolve from this source file.
 private static string Root([System.Runtime.CompilerServices.CallerFilePath]string source=""){var dir=new DirectoryInfo(Path.GetDirectoryName(source)!);while(dir!=null&&!File.Exists(Path.Combine(dir.FullName,"plugin.json")))dir=dir.Parent;return dir?.FullName??throw new InvalidOperationException("Storyboard repository root not found");}
 [Fact] public void CampaignHeartbeatFlowNodeHasASeededNodeType(){var seeds=JsonNode.Parse(File.ReadAllText(Path.Combine(Root(),"seeds","node-types.json")))!.AsArray();var seed=Assert.Single(seeds,s=>s?["slug"]?.GetValue<string>()==StoryCampaignPlay.ActionType);Assert.Equal("node-type",seed!["typeSlug"]!.GetValue<string>());}
}
