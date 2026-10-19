using BackupFotos.Core;
using MediaDevices;

namespace BackupFotos.App;

/// <summary>
/// Un móvil (o cámara) conectado por cable, a través de Windows Portable Devices (MTP):
/// lo mismo que usa el Explorador de Windows. Se recorre su memoria completa.
/// </summary>
public sealed class MtpSource : IMediaSource, IDisposable
{
    readonly MediaDevice _device;

    public MtpSource(MediaDevice device)
    {
        _device = device;
        if (!_device.IsConnected) _device.Connect();
        Name = DisplayName(device);
    }

    public string Name { get; }

    public static string DisplayName(MediaDevice d)
    {
        foreach (var get in new Func<string?>[] { () => d.FriendlyName, () => d.Description, () => d.Model })
        {
            try
            {
                var n = get();
                if (!string.IsNullOrWhiteSpace(n)) return n.Trim();
            }
            catch
            {
                // Algunos dispositivos no dan todos los datos sin conectar.
            }
        }
        return "Móvil";
    }

    static string DevicePath(string rel) => rel.Length == 0 ? @"\" : @"\" + rel.Replace('/', '\\');

    public IReadOnlyList<SourceEntry> List(string dir)
    {
        var info = _device.GetDirectoryInfo(DevicePath(dir));
        var list = new List<SourceEntry>();
        // En la raíz están las memorias (interna, tarjeta SD): pocas, se listan como carpetas.
        if (dir.Length == 0)
        {
            foreach (var d in info.EnumerateDirectories())
                list.Add(new SourceEntry(d.Name, d.Name, true, 0, null));
            return list;
        }
        // Una sola pasada por carpeta: por cable, cada consulta al móvil es lenta.
        foreach (var e in info.EnumerateFileSystemInfos())
        {
            var path = FolderSource.Join(dir, e.Name);
            if (e is MediaFileInfo f) list.Add(new SourceEntry(path, f.Name, false, (long)f.Length, f.LastWriteTime ?? f.CreationTime));
            else list.Add(new SourceEntry(path, e.Name, true, 0, null));
        }
        return list;
    }

    public void CopyTo(SourceEntry file, Stream destination, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _device.DownloadFile(DevicePath(file.Path), destination);
    }

    public void Dispose()
    {
        try
        {
            if (_device.IsConnected) _device.Disconnect();
        }
        catch
        {
            // El móvil ya se desconectó.
        }
    }
}
