namespace BackupFotos.Core;

/// <summary>Un archivo o carpeta del origen. La ruta es relativa a la raíz del origen y usa "/".</summary>
public sealed record SourceEntry(string Path, string Name, bool IsDirectory, long Size, DateTime? Modified);

/// <summary>
/// Origen de las fotos: un móvil conectado por cable (MTP, en la app) o una
/// carpeta (tests y discos). El motor solo necesita listar carpetas y copiar archivos.
/// </summary>
public interface IMediaSource
{
    /// <summary>Nombre del móvil (o carpeta): da nombre a la carpeta de la copia.</summary>
    string Name { get; }

    /// <summary>Contenido de una carpeta ("" = raíz).</summary>
    IReadOnlyList<SourceEntry> List(string dir);

    /// <summary>Copia el archivo en <paramref name="destination"/>.</summary>
    void CopyTo(SourceEntry file, Stream destination, CancellationToken ct);
}

/// <summary>Una carpeta del PC como origen.</summary>
public sealed class FolderSource(string root, string? name = null) : IMediaSource
{
    public string Name { get; } = name ?? new DirectoryInfo(root).Name;

    public IReadOnlyList<SourceEntry> List(string dir)
    {
        var full = dir.Length == 0 ? root : System.IO.Path.Combine(root, dir.Replace('/', System.IO.Path.DirectorySeparatorChar));
        var info = new DirectoryInfo(full);
        var list = new List<SourceEntry>();
        foreach (var d in info.EnumerateDirectories().OrderBy(d => d.Name, StringComparer.Ordinal))
            list.Add(new SourceEntry(Join(dir, d.Name), d.Name, true, 0, null));
        foreach (var f in info.EnumerateFiles().OrderBy(f => f.Name, StringComparer.Ordinal))
            list.Add(new SourceEntry(Join(dir, f.Name), f.Name, false, f.Length, f.LastWriteTime));
        return list;
    }

    public void CopyTo(SourceEntry file, Stream destination, CancellationToken ct)
    {
        using var s = File.OpenRead(System.IO.Path.Combine(root, file.Path.Replace('/', System.IO.Path.DirectorySeparatorChar)));
        s.CopyTo(destination, 1 << 20);
    }

    public static string Join(string dir, string name) => dir.Length == 0 ? name : $"{dir}/{name}";
}
