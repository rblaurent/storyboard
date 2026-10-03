using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
namespace Leaf.Plugins.Storyboard;
public static class StorySite {
 public static string ResolveRoot(string pluginDirectory){
  var packaged=Path.Combine(pluginDirectory,"backend","site");
  return Directory.Exists(Path.Combine(pluginDirectory,"backend"))?packaged:Path.Combine(pluginDirectory,"site-dist");
 }
 public static IResult Serve(string root,string? path){
  if(string.IsNullOrWhiteSpace(root))return Results.Json(new{error="site_not_built"},statusCode:503);
  path??="";
  if(path.Length>2048||path.Any(c=>char.IsControl(c)||"\\:%<>|\"?*".Contains(c))||path.StartsWith('/')||path.Split('/').Any(p=>p is "." or ".."))return Results.BadRequest(new{error="invalid_site_path"});
  root=Path.GetFullPath(root);var file=Path.GetFullPath(Path.Combine(root,path.Replace('/',Path.DirectorySeparatorChar)));
  if(file!=root&&!file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return Results.BadRequest(new{error="invalid_site_path"});
  if(path=="")file=Path.Combine(root,"index.html");
  if(!File.Exists(file)){
   if(!System.Text.RegularExpressions.Regex.IsMatch(path,"^campaigns/[a-fA-F0-9-]{36}/(?:description|players)$"))return Results.NotFound();
   file=Path.Combine(root,"index.html");
  }
  if(!File.Exists(file))return Results.Json(new{error="site_not_built"},statusCode:503);
  var types=new FileExtensionContentTypeProvider();if(!types.TryGetContentType(file,out var mime))return Results.NotFound();return Results.File(file,mime);
 }
}
