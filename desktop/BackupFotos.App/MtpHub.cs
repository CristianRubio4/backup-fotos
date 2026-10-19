using System.Collections.Concurrent;
using System.Runtime.ExceptionServices;
using BackupFotos.Core;
using MediaDevices;

namespace BackupFotos.App;

/// <summary>
/// Los móviles conectados, usados siempre desde un único hilo STA (WPD es COM):
/// el conector de la web y la ventana piden trabajo y esperan el resultado.
/// </summary>
public sealed class MtpHub : IDeviceHub, IDisposable
{
    readonly BlockingCollection<Action> _queue = new();
    readonly Dictionary<string, MtpSource> _open = new(StringComparer.Ordinal);
    readonly Thread _thread;

    public MtpHub()
    {
        _thread = new Thread(() =>
        {
            foreach (var work in _queue.GetConsumingEnumerable()) work();
            foreach (var s in _open.Values) s.Dispose();
        })
        { IsBackground = true, Name = "Móviles (WPD)" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    T Run<T>(Func<T> fn)
    {
        if (Thread.CurrentThread == _thread) return fn();
        T result = default!;
        ExceptionDispatchInfo? error = null;
        using var done = new ManualResetEventSlim();
        _queue.Add(() =>
        {
            try { result = fn(); }
            catch (Exception ex) { error = ExceptionDispatchInfo.Capture(ex); }
            finally { done.Set(); }
        });
        done.Wait();
        error?.Throw();
        return result;
    }

    /// <summary>
    /// Móviles enlazados con "Enlace móvil" (Phone Link): Windows los muestra en
    /// %USERPROFILE%\CrossDevice\&lt;nombre&gt; y trae cada archivo del móvil por wifi al leerlo.
    /// </summary>
    static string CrossDeviceRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "CrossDevice");

    const string LinkPrefix = "enlace:";

    static IEnumerable<DeviceInfo> LinkedPhones()
    {
        if (!Directory.Exists(CrossDeviceRoot)) yield break;
        string[] dirs;
        try { dirs = Directory.GetDirectories(CrossDeviceRoot); } catch { yield break; }
        foreach (var d in dirs)
        {
            var name = Path.GetFileName(d);
            if (!name.StartsWith('.')) yield return new DeviceInfo(LinkPrefix + name, $"{name} · Enlace móvil (wifi)");
        }
    }

    public IReadOnlyList<DeviceInfo> List() => Run(() =>
    {
        var list = new List<DeviceInfo>();
        foreach (var d in MediaDevice.GetDevices()) list.Add(new DeviceInfo(d.DeviceId, MtpSource.DisplayName(d)));
        list.AddRange(LinkedPhones());
        // Los que ya no están conectados se cierran.
        foreach (var gone in _open.Keys.Where(k => list.All(d => d.Id != k)).ToList())
        {
            _open[gone].Dispose();
            _open.Remove(gone);
        }
        return (IReadOnlyList<DeviceInfo>)list;
    });

    public void With(string deviceId, Action<IMediaSource> fn) => Run(() =>
    {
        // Enlace móvil: es una carpeta del PC; al leer cada archivo, Windows lo trae del móvil por wifi.
        if (deviceId.StartsWith(LinkPrefix, StringComparison.Ordinal))
        {
            var name = deviceId[LinkPrefix.Length..];
            var path = Path.Combine(CrossDeviceRoot, name);
            if (!Directory.Exists(path))
                throw new FileNotFoundException("El móvil ya no aparece en Enlace móvil. Abre la app Enlace a Windows en el móvil y comprueba que está conectado.");
            fn(new FolderSource(path, name));
            return true;
        }
        if (!_open.TryGetValue(deviceId, out var source))
        {
            var d = MediaDevice.GetDevices().FirstOrDefault(x => x.DeviceId == deviceId)
                ?? throw new FileNotFoundException("El móvil ya no está conectado. Conéctalo, desbloquéalo y elige \"Transferencia de archivos\".");
            source = new MtpSource(d);
            _open[deviceId] = source;
        }
        try
        {
            fn(source);
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
            // La conexión con el móvil se rompió (desconectado o bloqueado): se abrirá de nuevo la próxima vez.
            source.Dispose();
            _open.Remove(deviceId);
            throw;
        }
        return true;
    });

    public void Dispose() => _queue.CompleteAdding();
}
