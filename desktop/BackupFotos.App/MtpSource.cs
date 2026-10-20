using BackupFotos.Core;
using MediaDevices;

namespace BackupFotos.App;

/// <summary>
/// Un móvil (o cámara) conectado por cable, a través de Windows Portable Devices (MTP):
/// lo mismo que usa el Explorador de Windows. Se recorre su memoria completa.
///
/// La conexión con el móvil se puede cortar un instante (pantalla bloqueada, mal
/// contacto del cable, el móvil reinicia el modo de transferencia): entonces Windows
/// da errores como "ya se llamó a la función de apagado en este objeto". En ese caso
/// se vuelve a conectar al mismo móvil y se reintenta.
/// </summary>
public sealed class MtpSource : IMediaSource, IDisposable
{
    MediaDevice _device;
    readonly string _id;

    /// <summary>
    /// Archivos vistos al recorrer el móvil. Leerlos por su ruta obliga a la librería a buscarlos
    /// carpeta a carpeta, listando cada carpeta entera (en WhatsApp/Sent, miles de archivos por
    /// cada foto): ~1 s por archivo. Con el objeto ya encontrado, se lee directamente.
    /// </summary>
    readonly Dictionary<string, MediaFileInfo> _known = new(StringComparer.Ordinal);

    public MtpSource(MediaDevice device)
    {
        _device = device;
        _id = device.DeviceId;
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

    /// <summary>Cierra la conexión rota y abre otra con el mismo móvil (espera un poco si aún no ha vuelto).</summary>
    void Reconnect()
    {
        // Los objetos de la conexión anterior ya no valen.
        _known.Clear();
        try
        {
            if (_device.IsConnected) _device.Disconnect();
        }
        catch
        {
            // Ya estaba rota.
        }
        for (var i = 0; i < 6; i++)
        {
            var d = MediaDevice.GetDevices().FirstOrDefault(x => x.DeviceId == _id);
            if (d is not null)
            {
                try
                {
                    d.Connect();
                    _device = d;
                    return;
                }
                catch
                {
                    // El móvil aún se está reconectando.
                }
            }
            Thread.Sleep(1000);
        }
        throw new IOException("Se ha perdido la conexión con el móvil. Comprueba el cable, desbloquéalo y elige \"Transferencia de archivos\".");
    }

    static bool Retryable(Exception ex) => ex is not OperationCanceledException and not FileNotFoundException;

    public IReadOnlyList<SourceEntry> List(string dir)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return ListOnce(dir);
            }
            catch (Exception ex) when (attempt < 3 && Retryable(ex))
            {
                Reconnect();
            }
        }
    }

    IReadOnlyList<SourceEntry> ListOnce(string dir)
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
            if (e is MediaFileInfo f)
            {
                _known[path] = f;
                list.Add(new SourceEntry(path, f.Name, false, (long)f.Length, f.LastWriteTime ?? f.CreationTime));
            }
            else list.Add(new SourceEntry(path, e.Name, true, 0, null));
        }
        return list;
    }

    /// <summary>
    /// Copia el archivo. Si la conexión se corta a mitad, se reconecta y se lanza el error:
    /// quien llama descarta lo copiado a medias y lo vuelve a pedir (no se puede seguir
    /// escribiendo sobre una copia incompleta).
    /// </summary>
    public void CopyTo(SourceEntry file, Stream destination, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try
        {
            if (_known.TryGetValue(file.Path, out var info))
            {
                // Directo, sin buscarlo por su ruta.
                using var s = info.OpenRead();
                s.CopyTo(destination, 1 << 20);
            }
            else _device.DownloadFile(DevicePath(file.Path), destination);
        }
        catch (Exception ex) when (Retryable(ex))
        {
            try { Reconnect(); } catch { /* el error original es más útil */ }
            throw;
        }
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
