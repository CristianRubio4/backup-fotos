using System.Text;
using BackupFotos.Core;

namespace BackupFotos.Tests;

/// <summary>Móvil simulado en memoria, con carpetas ilegibles, archivos que fallan y desconexión.</summary>
public sealed class FakePhone(string name = "Galaxy S23") : IMediaSource
{
    readonly Dictionary<string, byte[]> _files = new(StringComparer.Ordinal);
    readonly HashSet<string> _dirs = new(StringComparer.Ordinal) { "" };
    public HashSet<string> BrokenDirs { get; } = [];
    public HashSet<string> BrokenFiles { get; } = [];
    public DateTime Modified { get; set; } = new(2024, 5, 17, 10, 30, 0);
    /// <summary>Se desconecta tras copiar tantos archivos.</summary>
    public int? DisconnectAfter { get; set; }
    public int Copies { get; private set; }
    bool _gone;

    public string Name { get; } = name;

    public FakePhone Add(string path, string content) => Add(path, Encoding.UTF8.GetBytes(content));

    public FakePhone Add(string path, byte[] bytes)
    {
        _files[path] = bytes;
        var parts = path.Split('/');
        for (var i = 1; i < parts.Length; i++) _dirs.Add(string.Join('/', parts[..i]));
        return this;
    }

    public FakePhone AddDir(string path)
    {
        var parts = path.Split('/');
        for (var i = 1; i <= parts.Length; i++) _dirs.Add(string.Join('/', parts[..i]));
        return this;
    }

    public IReadOnlyList<SourceEntry> List(string dir)
    {
        if (_gone) throw new IOException("El dispositivo no responde");
        if (BrokenDirs.Contains(dir)) throw new UnauthorizedAccessException("Acceso denegado");
        var prefix = dir.Length == 0 ? "" : dir + "/";
        var list = new List<SourceEntry>();
        foreach (var d in _dirs.Where(d => d.Length > 0 && d.StartsWith(prefix, StringComparison.Ordinal) && !d[prefix.Length..].Contains('/')).Order(StringComparer.Ordinal))
            list.Add(new SourceEntry(d, d[prefix.Length..], true, 0, null));
        foreach (var (path, bytes) in _files.Where(f => f.Key.StartsWith(prefix, StringComparison.Ordinal) && !f.Key[prefix.Length..].Contains('/')).OrderBy(f => f.Key, StringComparer.Ordinal))
            list.Add(new SourceEntry(path, path[prefix.Length..], false, bytes.Length, Modified));
        return list;
    }

    public void CopyTo(SourceEntry file, Stream destination, CancellationToken ct)
    {
        if (_gone) throw new IOException("El dispositivo no responde");
        if (BrokenFiles.Contains(file.Path)) throw new IOException("Error de lectura del dispositivo");
        destination.Write(_files[file.Path]);
        if (++Copies == DisconnectAfter) _gone = true;
    }
}

/// <summary>Carpeta temporal que se borra al terminar el test.</summary>
public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "backup-fotos-tests", Guid.NewGuid().ToString("N"));

    public TempDir() => Directory.CreateDirectory(Path);

    public void Dispose()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(Path, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
            Directory.Delete(Path, true);
        }
        catch
        {
            // Limpieza de mejor esfuerzo.
        }
    }
}
