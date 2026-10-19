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
        Stream s;
        try
        {
            s = File.OpenRead(System.IO.Path.Combine(root, file.Path.Replace('/', System.IO.Path.DirectorySeparatorChar)));
        }
        catch (IOException ex) when ((ex.HResult & 0xFFFF) is 0x16A or 0x16B or 0x179 or 0x17C or 0x183 or 0x186 or 0x18E)
        {
            // Errores de archivos "en la nube" (ERROR_CLOUD_FILE_*): en Enlace móvil, el móvil no responde por wifi.
            throw new IOException("No se ha podido traer el archivo del móvil por Enlace móvil: abre la app Enlace a Windows en el móvil, actívala y permite el acceso a archivos. Por cable es más fiable.", ex);
        }
        using (s) s.CopyTo(destination, 1 << 20);
    }

    public static string Join(string dir, string name) => dir.Length == 0 ? name : $"{dir}/{name}";
}
