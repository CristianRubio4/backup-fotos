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

    public IReadOnlyList<DeviceInfo> List() => Run(() =>
    {
        var list = new List<DeviceInfo>();
        foreach (var d in MediaDevice.GetDevices()) list.Add(new DeviceInfo(d.DeviceId, MtpSource.DisplayName(d)));
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
