using System.Diagnostics;
using System.Security.Cryptography;

namespace BackupFotos.Core;

public enum Phase { Scanning, Copying, Verifying, Saving, Done }

public enum Outcome { Completed, Cancelled, SourceDisconnected, DiskFull, Failed }

public sealed record BackupProgress(
    Phase Phase,
    int FilesDone,
    int FilesTotal,
    long BytesDone,
    long BytesTotal,
    string? Current,
    int DirsScanned,
    int FilesFound,
    double BytesPerSecond);

public sealed record FileProblem(string Path, string Reason);

public sealed class BackupResult
{
    public Outcome Outcome { get; set; } = Outcome.Completed;
    public string? Failure { get; set; }
    /// <summary>Carpeta de esta copia ("Galaxy S23 - 2026-10-19 14h30"), ruta completa.</summary>
    public string? Folder { get; set; }
    public int Found { get; set; }
    public int Copied { get; set; }
    public long BytesCopied { get; set; }
    /// <summary>Archivos repetidos dentro del móvil (mismo contenido): se copian una vez.</summary>
    public List<FileProblem> Duplicates { get; } = [];
    public List<FileProblem> Errors { get; } = [];
    public List<string> Ignored { get; } = [];
    public List<string> Dirs { get; } = [];
    public List<string> EmptyFiles { get; } = [];
    public TimeSpan Elapsed { get; set; }
}

public sealed class BackupOptions
{
    public required IMediaSource Source { get; init; }
    /// <summary>Carpeta elegida como destino: dentro se crea una carpeta por copia.</summary>
    public required string DestinationRoot { get; init; }
    /// <summary>Este PC (para el registro).</summary>
    public string DeviceId { get; init; } = "pc";
    public string DeviceName { get; init; } = Environment.MachineName;
    /// <summary>Releer cada archivo copiado y comparar su huella (SHA-256).</summary>
    public bool Verify { get; init; } = true;
    public Func<DateTime> Now { get; init; } = () => DateTime.Now;
    public Func<string, DateTime?> ReadDate { get; init; } = ExifDate.Read;
    /// <summary>Guardar el registro cada tantos archivos.</summary>
    public int SaveEvery { get; init; } = 25;
}

/// <summary>Se lanza cuando el origen deja de responder (móvil desconectado o bloqueado).</summary>
public sealed class SourceDisconnectedException(string message) : Exception(message);

/// <summary>
/// Backup completo del origen en una carpeta nueva "Nombre del móvil - fecha hora",
/// con todo dentro (fotos, vídeos y archivos de control). Cada archivo se escribe
/// primero como .part y solo pasa a su nombre final cuando está completo y verificado:
/// nunca queda una foto a medias con su nombre. Nunca se borra ni se modifica nada en el origen.
/// </summary>
public static class BackupEngine
{
    const int Buffer = 1 << 20;

    public static BackupResult Run(BackupOptions o, IProgress<BackupProgress>? progress, CancellationToken ct)
    {
        var result = new BackupResult();
        var clock = Stopwatch.StartNew();
        var started = o.Now();
        Manifest? manifest = null;
        string? folder = null;
        var bytes = new Counter();
        long bytesTotal = 0;
        int filesDone = 0;
        var speed = new SpeedMeter();
        var lastReport = 0L;
        BackupProgress? last = null;

        void Report(Phase phase, string? current, int filesTotal, int dirs = 0, int found = 0, bool force = false)
        {
            if (!force && clock.ElapsedMilliseconds - lastReport < 120) return;
            lastReport = clock.ElapsedMilliseconds;
            speed.Sample(clock.Elapsed, bytes.Value);
            last = new BackupProgress(phase, filesDone, filesTotal, bytes.Value, bytesTotal, current, dirs == 0 ? last?.DirsScanned ?? 0 : dirs, found == 0 ? last?.FilesFound ?? 0 : found, speed.Rate);
            progress?.Report(last);
        }

        try
        {
            // ---- 1. Buscar todas las fotos y vídeos, en todas las carpetas ----
            Report(Phase.Scanning, null, 0, force: true);
            ScanResult scan;
            try
            {
                scan = Scanner.Scan(o.Source, ct, (s, dir) => Report(Phase.Scanning, dir, 0, s.Dirs.Count, s.Files.Count));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                throw new SourceDisconnectedException($"No se puede leer el móvil: {ex.Message}");
            }
            result.Dirs.AddRange(scan.Dirs);
            result.Ignored.AddRange(scan.Ignored);
            foreach (var (path, reason) in scan.Unreadable) result.Errors.Add(new FileProblem(path, $"Carpeta no legible: {reason}"));
            var files = new List<SourceEntry>();
            foreach (var f in scan.Files)
            {
                // Un archivo de 0 bytes no tiene nada que guardar.
                if (f.Size == 0) result.EmptyFiles.Add(f.Path);
                else files.Add(f);
            }
            result.Found = scan.Files.Count;
            bytesTotal = files.Sum(f => f.Size) * (o.Verify ? 2 : 1);

            // ---- 2. La carpeta de esta copia ----
            Directory.CreateDirectory(o.DestinationRoot);
            var baseName = Naming.RunFolderName(started, o.Source.Name);
            folder = Path.Combine(o.DestinationRoot, baseName);
            for (var n = 2; Directory.Exists(folder); n++) folder = Path.Combine(o.DestinationRoot, $"{baseName} ({n})");
            Directory.CreateDirectory(folder);
            result.Folder = folder;
            var diskId = Guid.NewGuid().ToString();
            ControlFiles.WriteDiskId(folder, new DiskIdFile { Id = diskId, Name = Path.GetFileName(folder), CreatedAt = Naming.UtcIso(started) });
            manifest = new Manifest { DiskId = diskId, CreatedAt = Naming.UtcIso(started), UpdatedAt = Naming.UtcIso(started) };
            ControlFiles.SaveManifest(folder, manifest);

            // ---- 3. Copiar y verificar, de uno en uno ----
            var seen = new Dictionary<string, string>(StringComparer.Ordinal); // hash → ruta en la copia
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var sinceSave = 0;
            var consecutiveErrors = 0;
            foreach (var f in files)
            {
                ct.ThrowIfCancellationRequested();
                Report(Phase.Copying, f.Path, files.Count, force: true);
                try
                {
                    var outcome = CopyOne(o, f, folder, seen, used, bytes, () => Report(Phase.Copying, f.Path, files.Count), () => Report(Phase.Verifying, f.Path, files.Count, force: true), ct);
                    if (outcome.Duplicate is { } dupOf)
                    {
                        result.Duplicates.Add(new FileProblem(f.Path, $"Igual que {dupOf}"));
                        if (o.Verify) bytes.Value += f.Size;
                    }
                    else
                    {
                        manifest.Entries.Add(outcome.Entry!);
                        result.Copied++;
                        result.BytesCopied += f.Size;
                        if (++sinceSave >= o.SaveEvery)
                        {
                            Save(manifest, folder, o);
                            sinceSave = 0;
                        }
                    }
                    consecutiveErrors = 0;
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (IOException ex) when (IsDiskFull(ex))
                {
                    result.Outcome = Outcome.DiskFull;
                    result.Failure = "El disco de destino se ha llenado. Lo copiado hasta ahora está guardado y verificado.";
                    break;
                }
                catch (Exception ex)
                {
                    result.Errors.Add(new FileProblem(f.Path, ex.Message));
                    // Varios fallos seguidos: ¿se ha desconectado el móvil?
                    if (++consecutiveErrors >= 3 && !SourceAlive(o.Source))
                        throw new SourceDisconnectedException("El móvil se ha desconectado o bloqueado durante el backup. Lo copiado hasta ahora está guardado y verificado.");
                }
                filesDone++;
            }
        }
        catch (OperationCanceledException)
        {
            result.Outcome = Outcome.Cancelled;
        }
        catch (SourceDisconnectedException ex)
        {
            result.Outcome = Outcome.SourceDisconnected;
            result.Failure = ex.Message;
        }
        catch (IOException ex) when (IsDiskFull(ex))
        {
            result.Outcome = Outcome.DiskFull;
            result.Failure = "El disco de destino está lleno.";
        }
        catch (Exception ex)
        {
            result.Outcome = Outcome.Failed;
            result.Failure = ex.Message;
        }
        finally
        {
            if (manifest is not null && folder is not null)
            {
                Report(Phase.Saving, null, filesDone, force: true);
                try
                {
                    Save(manifest, folder, o);
                }
                catch (Exception ex)
                {
                    if (result.Outcome == Outcome.Completed)
                    {
                        result.Outcome = Outcome.Failed;
                        result.Failure = $"No se pudo guardar el registro de la copia: {ex.Message}";
                    }
                }
            }
            result.Elapsed = clock.Elapsed;
            Report(Phase.Done, null, filesDone, force: true);
        }
        return result;
    }

    static void Save(Manifest m, string folder, BackupOptions o)
    {
        m.UpdatedAt = Naming.UtcIso(o.Now());
        ControlFiles.SaveManifest(folder, m);
    }

    sealed record CopyOutcome(ManifestEntry? Entry, string? Duplicate);

    sealed class Counter { public long Value; }

    static CopyOutcome CopyOne(BackupOptions o, SourceEntry f, string folder, Dictionary<string, string> seen, HashSet<string> used, Counter bytes, Action onCopyProgress, Action onVerify, CancellationToken ct)
    {
        string? note = null;
        for (var attempt = 1; ; attempt++)
        {
            var part = Path.Combine(folder, $".{Guid.NewGuid():N}.part");
            try
            {
                // Copia en un .part mientras se calcula la huella de lo recibido.
                string hash;
                long written;
                var start = bytes.Value;
                using (var fs = new FileStream(part, FileMode.CreateNew, FileAccess.Write, FileShare.None, Buffer, FileOptions.SequentialScan))
                {
                    using var hs = new HashingStream(fs, n =>
                    {
                        ct.ThrowIfCancellationRequested();
                        bytes.Value += n;
                        onCopyProgress();
                    });
                    o.Source.CopyTo(f, hs, ct);
                    hs.Flush();
                    fs.Flush(flushToDisk: true);
                    hash = hs.Hash();
                    written = hs.Written;
                }
                bytes.Value = start + written;
                onCopyProgress();
                if (written != f.Size && f.Size > 0)
                    note = $"El tamaño recibido ({written} bytes) no coincide con el que indica el móvil ({f.Size})";

                // Una foto repetida en otra carpeta del móvil también se copia allí: cada carpeta queda completa,
                // con la misma estructura que en el móvil.

                // Misma estructura de carpetas y mismo nombre que en el móvil: DCIM/Camera/IMG_1234.jpg
                var exif = o.ReadDate(part);
                var (date, fromExif) = Naming.PickDate(exif, f.Modified, o.Now());
                var segments = f.Path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Naming.Sanitize).ToArray();
                var dirRel = string.Join('/', segments[..^1]);
                var baseName = segments[^1];
                string name;
                var n = 0;
                do name = dirRel.Length == 0 ? Naming.WithSuffix(baseName, n++) : $"{dirRel}/{Naming.WithSuffix(baseName, n++)}";
                while (used.Contains(name) || File.Exists(Path.Combine(folder, name)));
                if (dirRel.Length > 0) Directory.CreateDirectory(Path.Combine(folder, dirRel));

                // Verificación: se relee lo escrito y se compara la huella.
                if (o.Verify)
                {
                    onVerify();
                    var back = HashFile(part, nb => bytes.Value += nb, ct);
                    if (back != hash)
                    {
                        File.Delete(part);
                        bytes.Value = start;
                        if (attempt < 2) continue;
                        throw new IOException("La copia no coincide con el original (2 intentos). El original sigue intacto en el móvil.");
                    }
                }

                var final = Path.Combine(folder, name);
                File.Move(part, final);
                if (f.Modified is { } mod) TrySetTimes(final, mod);
                used.Add(name);
                seen[hash] = name;
                return new CopyOutcome(new ManifestEntry
                {
                    Hash = hash,
                    Size = written,
                    OriginalName = f.Name,
                    SourcePath = $"{o.Source.Name}/{f.Path}",
                    DiskPath = name,
                    ExifDate = fromExif && date is { } d ? Naming.LocalIso(d) : null,
                    FileDate = Naming.UtcIso(f.Modified ?? o.Now()),
                    DeviceId = o.DeviceId,
                    DeviceName = o.DeviceName,
                    Status = o.Verify && note is null ? "verified" : "unverified",
                    Note = note ?? (o.Verify ? null : "Solo se copió, sin releer para verificar"),
                    CopiedAt = Naming.UtcIso(o.Now()),
                }, null);
            }
            catch (Exception ex)
            {
                try { if (File.Exists(part)) File.Delete(part); } catch { /* se limpia en el siguiente intento */ }
                // Un corte momentáneo con el móvil: se vuelve a copiar entero (la copia a medias ya se ha borrado).
                if (attempt < 3 && ex is not OperationCanceledException and not FileNotFoundException && !(ex is IOException io && IsDiskFull(io)))
                {
                    bytes.Value = Math.Max(0, bytes.Value - f.Size);
                    Thread.Sleep(300 * attempt);
                    continue;
                }
                throw;
            }
        }
    }

    static string HashFile(string path, Action<long> onBytes, CancellationToken ct)
    {
        using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, Buffer, FileOptions.SequentialScan);
        using var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buf = new byte[Buffer];
        int read;
        while ((read = s.Read(buf, 0, buf.Length)) > 0)
        {
            ct.ThrowIfCancellationRequested();
            h.AppendData(buf, 0, read);
            onBytes(read);
        }
        return Convert.ToHexString(h.GetHashAndReset()).ToLowerInvariant();
    }

    static void TrySetTimes(string path, DateTime modified)
    {
        try
        {
            File.SetLastWriteTime(path, modified);
            File.SetCreationTime(path, modified);
        }
        catch
        {
            // No es grave: la fecha va también en el nombre y en el registro.
        }
    }

    static bool SourceAlive(IMediaSource s)
    {
        try
        {
            s.List("");
            return true;
        }
        catch
        {
            return false;
        }
    }

    static bool IsDiskFull(IOException ex) => (ex.HResult & 0xFFFF) is 0x70 or 0x27; // ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL
}
