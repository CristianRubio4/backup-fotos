namespace BackupFotos.Core;

public sealed class ScanResult
{
    public List<SourceEntry> Files { get; } = [];
    public List<string> Ignored { get; } = [];
    /// <summary>Carpetas recorridas, con cuántos archivos tenía cada una.</summary>
    public List<string> Dirs { get; } = [];
    public List<(string Path, string Reason)> Unreadable { get; } = [];
}

/// <summary>Recorre el origen entero, carpeta a carpeta, a cualquier profundidad.</summary>
public static class Scanner
{
    public static ScanResult Scan(IMediaSource source, CancellationToken ct, Action<ScanResult, string>? onDir = null)
    {
        var result = new ScanResult();
        // Recorrido en profundidad sin recursión (un móvil puede tener carpetas muy anidadas).
        var stack = new Stack<string>();
        stack.Push("");
        while (stack.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            var dir = stack.Pop();
            IReadOnlyList<SourceEntry> entries;
            try
            {
                entries = source.List(dir);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // La raíz ilegible es un fallo de verdad (móvil desconectado o bloqueado); una subcarpeta, no.
                if (dir.Length == 0) throw;
                result.Unreadable.Add((dir, ex.Message));
                continue;
            }
            int files = 0, media = 0;
            var subdirs = new List<string>();
            foreach (var e in entries)
            {
                if (e.IsDirectory)
                {
                    if (!Media.SkipDir(e.Name, e.Path)) subdirs.Add(e.Path);
                    continue;
                }
                files++;
                if (Media.IsMedia(e.Name))
                {
                    media++;
                    result.Files.Add(e);
                }
                else result.Ignored.Add(e.Path);
            }
            var label = dir.Length == 0 ? source.Name : $"{source.Name}/{dir}";
            result.Dirs.Add(files == 0 ? $"{label} · vacía" : $"{label} · {media} fotos y vídeos de {files} archivos");
            onDir?.Invoke(result, dir);
            // En orden alfabético al sacarlas de la pila.
            for (var i = subdirs.Count - 1; i >= 0; i--) stack.Push(subdirs[i]);
        }
        return result;
    }
}
