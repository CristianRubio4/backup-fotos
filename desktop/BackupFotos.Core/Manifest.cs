using System.Text.Json;
using System.Text.Json.Serialization;

namespace BackupFotos.Core;

/// <summary>Una foto copiada. Mismo formato que la web (src/core/manifest/schema.ts), así la web puede explorar estas copias.</summary>
public sealed class ManifestEntry
{
    public required string Hash { get; init; }
    public required long Size { get; init; }
    public required string OriginalName { get; init; }
    public required string SourcePath { get; init; }
    public required string DiskPath { get; init; }
    /// <summary>Fecha EXIF en hora local (YYYY-MM-DDTHH:mm:ss) o null. Siempre se escribe (la web exige null, no ausente).</summary>
    public string? ExifDate { get; init; }
    public required string FileDate { get; init; }
    public required string DeviceId { get; init; }
    public required string DeviceName { get; init; }
    public required string Status { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Note { get; init; }
    public required string CopiedAt { get; init; }
}

public sealed class Manifest
{
    public int Version { get; init; } = 1;
    public required string DiskId { get; init; }
    public required string CreatedAt { get; init; }
    public string UpdatedAt { get; set; } = "";
    public List<ManifestEntry> Entries { get; init; } = [];
}

public sealed class DiskIdFile
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string CreatedAt { get; init; }
}

/// <summary>Archivos de control dentro de la carpeta de la copia (ocultos, como en la web empiezan por ".").</summary>
public static class ControlFiles
{
    public const string DiskId = ".backup-disk-id";
    public const string Manifest = ".backup-manifest.json";
    public const string ManifestTmp = ".backup-manifest.tmp";
    public const string ManifestBak = ".backup-manifest.bak";

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>Carpeta de los archivos de control dentro de cada copia (la copia solo muestra fotos y vídeos).</summary>
    public const string Dir = ".backup-ignore";

    static string ControlPath(string folder, string name)
    {
        var dir = Path.Combine(folder, Dir);
        Directory.CreateDirectory(dir);
        if (OperatingSystem.IsWindows()) File.SetAttributes(dir, File.GetAttributes(dir) | FileAttributes.Hidden);
        return Path.Combine(dir, name);
    }

    public static void WriteDiskId(string folder, DiskIdFile info) =>
        WriteHidden(ControlPath(folder, DiskId), JsonSerializer.Serialize(info, new JsonSerializerOptions(Json) { WriteIndented = true }));

    /// <summary>Escritura segura: .tmp completo → sustituye al manifest y deja el anterior en .bak.</summary>
    public static void SaveManifest(string folder, Manifest m)
    {
        var tmp = ControlPath(folder, ManifestTmp);
        var final = ControlPath(folder, Manifest);
        WriteHidden(tmp, JsonSerializer.Serialize(m, Json));
        if (File.Exists(final))
        {
            // File.Replace no admite destinos ocultos en todos los sistemas: se quita el atributo antes.
            Unhide(final);
            var bak = ControlPath(folder, ManifestBak);
            if (File.Exists(bak)) Unhide(bak);
            File.Replace(tmp, final, bak, ignoreMetadataErrors: true);
            Hide(bak);
        }
        else File.Move(tmp, final);
        Hide(final);
    }

    public static Manifest? Load(string folder)
    {
        // En .backup-ignore, o suelto en copias de versiones anteriores.
        foreach (var path in new[] { Path.Combine(folder, Dir, Manifest), Path.Combine(folder, Manifest) })
            if (File.Exists(path)) return JsonSerializer.Deserialize<Manifest>(File.ReadAllText(path), Json);
        return null;
    }

    static void WriteHidden(string path, string text)
    {
        if (File.Exists(path)) Unhide(path);
        using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
        using (var w = new StreamWriter(fs, new System.Text.UTF8Encoding(false)))
        {
            w.Write(text);
            w.Flush();
            fs.Flush(flushToDisk: true);
        }
        Hide(path);
    }

    static void Hide(string path)
    {
        if (OperatingSystem.IsWindows() && File.Exists(path)) File.SetAttributes(path, File.GetAttributes(path) | FileAttributes.Hidden);
    }

    static void Unhide(string path)
    {
        if (OperatingSystem.IsWindows()) File.SetAttributes(path, File.GetAttributes(path) & ~FileAttributes.Hidden);
    }
}
