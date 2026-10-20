using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace BackupFotos.Core;

public sealed record DeviceInfo(string Id, string Name);

/// <summary>Acceso a los móviles conectados. En la app, todo pasa por un único hilo (WPD es COM).</summary>
public interface IDeviceHub
{
    IReadOnlyList<DeviceInfo> List();

    /// <summary>Ejecuta <paramref name="fn"/> con el origen de ese móvil, en el hilo de los dispositivos.</summary>
    void With(string deviceId, Action<IMediaSource> fn);
}

/// <summary>
/// Conector local para la web: un pequeño servidor HTTP en 127.0.0.1 (solo este PC)
/// que deja a la web listar el móvil conectado por cable y leer sus archivos.
/// Solo responde a los orígenes permitidos (la web publicada y la de desarrollo).
///
///   GET /v1/info                     → { app, version, devices: [{ id, name }] }
///   GET /v1/scan?device=ID           → NDJSON: {"t":"dir",…} … {"t":"file",…} … {"t":"done"}
///   GET /v1/file?device=ID&amp;path=RUTA → contenido del archivo
/// </summary>
public sealed class ConnectorServer : IDisposable
{
    public const int DefaultPort = 47613;
    public const string AppId = "backup-fotos-conector";

    public static readonly string[] DefaultOrigins =
    [
        "https://cristianrubio4.github.io",
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
    ];

    readonly IDeviceHub _hub;
    readonly HashSet<string> _origins;
    readonly TcpListener _listener;
    readonly FileCache _cache;
    readonly CancellationTokenSource _stop = new();
    readonly string _version;
    long _readBytes;
    TimeSpan _readTime;
    int _readFiles;

    static string Speed(long bytes, TimeSpan t)
    {
        var bps = t.TotalSeconds > 0 ? bytes / t.TotalSeconds : 0;
        return bps >= 1 << 20 ? $"{bps / (1 << 20):0.0} MB/s" : $"{bps / 1024:0} KB/s";
    }

    /// <summary>Archivos del último escaneo de cada móvil (para no volver a listar la carpeta en cada lectura).</summary>
    readonly Dictionary<string, Dictionary<string, SourceEntry>> _entries = new(StringComparer.Ordinal);

    public int Port { get; }

    /// <summary>Peticiones atendidas (para mostrar actividad en la ventana).</summary>
    public event Action<string>? Activity;

    public ConnectorServer(IDeviceHub hub, int port = DefaultPort, IEnumerable<string>? origins = null, string? cacheDir = null, long cacheBytes = 4L << 30, string version = "1")
    {
        _hub = hub;
        _origins = new HashSet<string>(origins ?? DefaultOrigins, StringComparer.OrdinalIgnoreCase);
        _cache = new FileCache(cacheDir ?? Path.Combine(Path.GetTempPath(), "BackupFotos-conector"), cacheBytes);
        _version = version;
        _listener = new TcpListener(IPAddress.Loopback, port);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = AcceptLoop();
    }

    async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_stop.Token);
            }
            catch
            {
                return;
            }
            _ = Task.Run(() => Handle(client));
        }
    }

    sealed record Request(string Method, string Path, Dictionary<string, string> Query, Dictionary<string, string> Headers);

    void Handle(TcpClient client)
    {
        using var _ = client;
        client.NoDelay = true;
        var stream = client.GetStream();
        Request req;
        try
        {
            req = ReadRequest(stream);
        }
        catch
        {
            return;
        }
        var origin = req.Headers.GetValueOrDefault("origin");
        var allowed = origin is not null && _origins.Contains(origin);
        try
        {
            if (!allowed)
            {
                WriteText(stream, 403, "Solo la web de Backup de fotos puede usar el conector.", null);
                return;
            }
            if (req.Method == "OPTIONS")
            {
                WriteHead(stream, 204, origin, null, 0, extra: "Access-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 600\r\n");
                return;
            }
            if (req.Method != "GET")
            {
                WriteText(stream, 405, "Método no permitido", origin);
                return;
            }
            switch (req.Path)
            {
                case "/v1/info":
                    WriteJson(stream, origin!, new { app = AppId, version = _version, devices = _hub.List() });
                    break;
                case "/v1/scan":
                    Scan(stream, origin!, Required(req, "device"), req.Query.GetValueOrDefault("sent") == "0");
                    break;
                case "/v1/file":
                    ServeFile(stream, origin!, Required(req, "device"), Required(req, "path"));
                    break;
                default:
                    WriteText(stream, 404, "No existe", origin);
                    break;
            }
        }
        catch (ArgumentException ex)
        {
            TryWrite(() => WriteText(stream, 400, ex.Message, origin));
        }
        catch (FileNotFoundException ex)
        {
            TryWrite(() => WriteText(stream, 404, ex.Message, origin));
        }
        catch (Exception ex)
        {
            TryWrite(() => WriteText(stream, 502, ex.Message, origin));
        }
    }

    static string Required(Request r, string key) =>
        r.Query.TryGetValue(key, out var v) && v.Length > 0 ? v : throw new ArgumentException($"Falta el parámetro {key}");

    // ---- Escaneo: el recorrido completo del móvil, enviado según avanza ----

    void Scan(Stream stream, string origin, string deviceId, bool skipSent)
    {
        Activity?.Invoke("Buscando fotos en el móvil…");
        var headSent = false;
        using var body = new ChunkedStream(stream);
        void Line(object o)
        {
            if (!headSent)
            {
                WriteHead(stream, 200, origin, "application/x-ndjson; charset=utf-8", -1);
                headSent = true;
            }
            var bytes = JsonSerializer.SerializeToUtf8Bytes(o);
            body.Write(bytes);
            body.Write("\n"u8);
            body.Flush();
        }
        try
        {
            _hub.With(deviceId, source =>
            {
                var lastDirs = 0;
                // Primera línea enseguida: la web sabe que el conector está trabajando.
                Line(new { t = "start", name = source.Name });
                var result = Scanner.Scan(source, _stop.Token, onDir: (s, dir) =>
                {
                    if (s.Dirs.Count - lastDirs < 5) return;
                    lastDirs = s.Dirs.Count;
                    Line(new { t = "dir", path = dir, dirs = s.Dirs.Count, found = s.Files.Count });
                    Activity?.Invoke($"Buscando fotos en el móvil: {s.Dirs.Count:N0} carpetas revisadas, {s.Files.Count:N0} fotos y vídeos encontrados");
                }, skipSent: skipSent);
                lock (_entries) _entries[deviceId] = result.Files.ToDictionary(f => f.Path, StringComparer.Ordinal);
                foreach (var f in result.Files)
                    Line(new { t = "file", path = f.Path, name = f.Name, size = f.Size, mtime = f.Modified is { } m ? new DateTimeOffset(m).ToUnixTimeMilliseconds() : 0 });
                foreach (var i in result.Ignored) Line(new { t = "ignored", path = i });
                foreach (var (path, reason) in result.Unreadable) Line(new { t = "error", path, reason });
                Line(new { t = "done", name = source.Name, dirs = result.Dirs, found = result.Files.Count });
            });
        }
        catch (Exception ex) when (headSent)
        {
            // La respuesta ya empezó: el fallo va como una línea más.
            TryWrite(() => Line(new { t = "fail", reason = ex.Message }));
        }
        body.Finish();
        Activity?.Invoke("Listo");
    }

    // ---- Archivos: se descargan del móvil a una caché temporal y se sirven desde ahí ----

    void ServeFile(Stream stream, string origin, string deviceId, string path)
    {
        var cached = _cache.Get(deviceId, path);
        if (cached is null)
        {

            _hub.With(deviceId, source =>
            {
                SourceEntry? entry = null;
                lock (_entries) if (_entries.TryGetValue(deviceId, out var known)) known.TryGetValue(path, out entry);
                if (entry is null)
                {
                    var slash = path.LastIndexOf('/');
                    var dir = slash < 0 ? "" : path[..slash];
                    entry = source.List(dir).FirstOrDefault(e => !e.IsDirectory && e.Path == path)
                        ?? throw new FileNotFoundException($"No está en el móvil: {path}");
                }
                // Si la conexión con el móvil se corta a mitad, se descarta lo leído y se vuelve a pedir entero.
                for (var attempt = 1; ; attempt++)
                {
                    try
                    {
                        var clock = System.Diagnostics.Stopwatch.StartNew();
                        cached = _cache.Put(deviceId, path, s => source.CopyTo(entry, s, _stop.Token));
                        // Velocidad real de lectura del móvil (para saber si el cuello de botella es el cable o la wifi).
                        _readBytes += entry.Size;
                        _readTime += clock.Elapsed;
                        _readFiles++;
                        var via = deviceId.StartsWith("enlace:", StringComparison.Ordinal) ? "por wifi (Enlace móvil)" : "por cable";
                        Activity?.Invoke($"Copiando {path}\nLeyendo del móvil {via}: {Speed(_readBytes, _readTime)} de media, {_readTime.TotalMilliseconds / Math.Max(1, _readFiles):0} ms por archivo ({_readFiles:N0} archivos)");
                        break;
                    }
                    catch (Exception ex) when (attempt < 3 && ex is not OperationCanceledException and not FileNotFoundException)
                    {
                        Activity?.Invoke($"Reintentando {path} (la conexión con el móvil se cortó)");
                        Thread.Sleep(500 * attempt);
                    }
                }
            });
        }
        using var file = new FileStream(cached!, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20);
        WriteHead(stream, 200, origin, "application/octet-stream", file.Length);
        file.CopyTo(stream, 1 << 20);
        stream.Flush();
    }

    // ---- HTTP mínimo ----

    static Request ReadRequest(Stream s)
    {
        var head = new StringBuilder();
        var buf = new byte[1];
        while (!head.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal))
        {
            if (s.Read(buf, 0, 1) != 1) throw new IOException("Conexión cerrada");
            head.Append((char)buf[0]);
            if (head.Length > 16 * 1024) throw new IOException("Cabecera demasiado grande");
        }
        var lines = head.ToString().Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        var first = lines[0].Split(' ');
        var target = first[1];
        var q = target.IndexOf('?');
        var query = new Dictionary<string, string>(StringComparer.Ordinal);
        if (q >= 0)
        {
            foreach (var pair in target[(q + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = pair.IndexOf('=');
                var k = Uri.UnescapeDataString((eq < 0 ? pair : pair[..eq]).Replace('+', ' '));
                var v = eq < 0 ? "" : Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' '));
                query[k] = v;
            }
        }
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines.Skip(1))
        {
            var c = l.IndexOf(':');
            if (c > 0) headers[l[..c].Trim()] = l[(c + 1)..].Trim();
        }
        return new Request(first[0].ToUpperInvariant(), q >= 0 ? target[..q] : target, query, headers);
    }

    static void WriteHead(Stream s, int status, string? origin, string? type, long length, string extra = "")
    {
        var sb = new StringBuilder();
        sb.Append($"HTTP/1.1 {status} {Reason(status)}\r\n");
        if (origin is not null) sb.Append($"Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Private-Network: true\r\n");
        if (type is not null) sb.Append($"Content-Type: {type}\r\n");
        sb.Append(length >= 0 ? $"Content-Length: {length}\r\n" : "Transfer-Encoding: chunked\r\n");
        sb.Append("Cache-Control: no-store\r\nConnection: close\r\n");
        sb.Append(extra);
        sb.Append("\r\n");
        var b = Encoding.ASCII.GetBytes(sb.ToString());
        s.Write(b);
    }

    static void WriteJson(Stream s, string origin, object value)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(value, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        WriteHead(s, 200, origin, "application/json; charset=utf-8", body.Length);
        s.Write(body);
    }

    static void WriteText(Stream s, int status, string text, string? origin)
    {
        var body = Encoding.UTF8.GetBytes(text);
        WriteHead(s, status, origin, "text/plain; charset=utf-8", body.Length);
        s.Write(body);
    }

    static void TryWrite(Action a)
    {
        try { a(); } catch { /* el cliente ya se fue */ }
    }

    static string Reason(int status) => status switch
    {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
        _cache.Dispose();
    }
}

/// <summary>Cuerpo HTTP "chunked" (para enviar el escaneo según avanza).</summary>
sealed class ChunkedStream(Stream inner) : Stream
{
    bool _finished;

    public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));

    public override void Write(ReadOnlySpan<byte> buffer)
    {
        if (buffer.Length == 0) return;
        inner.Write(Encoding.ASCII.GetBytes($"{buffer.Length:X}\r\n"));
        inner.Write(buffer);
        inner.Write("\r\n"u8);
    }

    public void Finish()
    {
        if (_finished) return;
        _finished = true;
        try
        {
            inner.Write("0\r\n\r\n"u8);
            inner.Flush();
        }
        catch
        {
            // El cliente ya se fue.
        }
    }

    public override void Flush() => inner.Flush();
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
}

/// <summary>
/// Caché en disco de los archivos leídos del móvil: la web lee cada archivo varias
/// veces (análisis, copia) y por cable cada lectura es lenta. Se vacía al cerrar.
/// </summary>
sealed class FileCache : IDisposable
{
    readonly string _dir;
    readonly long _max;
    readonly object _lock = new();
    readonly LinkedList<(string Key, string File, long Size)> _lru = new();
    readonly Dictionary<string, LinkedListNode<(string Key, string File, long Size)>> _map = new(StringComparer.Ordinal);
    long _total;

    public FileCache(string dir, long maxBytes)
    {
        _dir = dir;
        _max = maxBytes;
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { /* restos de otra sesión */ }
        Directory.CreateDirectory(dir);
    }

    static string Key(string device, string path) => device + "\n" + path;

    public string? Get(string device, string path)
    {
        lock (_lock)
        {
            if (!_map.TryGetValue(Key(device, path), out var node) || !File.Exists(node.Value.File)) return null;
            _lru.Remove(node);
            _lru.AddFirst(node);
            return node.Value.File;
        }
    }

    public string Put(string device, string path, Action<Stream> fill)
    {
        var file = Path.Combine(_dir, Guid.NewGuid().ToString("N"));
        try
        {
            using (var fs = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 20))
                fill(fs);
        }
        catch
        {
            try { File.Delete(file); } catch { /* nada */ }
            throw;
        }
        var size = new FileInfo(file).Length;
        lock (_lock)
        {
            var key = Key(device, path);
            if (_map.Remove(key, out var old))
            {
                _lru.Remove(old);
                _total -= old.Value.Size;
                TryDelete(old.Value.File);
            }
            _map[key] = _lru.AddFirst((key, file, size));
            _total += size;
            // Se deja siempre el recién leído, aunque supere el máximo.
            while (_total > _max && _lru.Last is { } last && last.Value.File != file)
            {
                _lru.RemoveLast();
                _map.Remove(last.Value.Key);
                _total -= last.Value.Size;
                TryDelete(last.Value.File);
            }
        }
        return file;
    }

    static void TryDelete(string f)
    {
        // Si se está enviando, Windows lo borra al cerrarlo (FileShare.Delete).
        try { File.Delete(f); } catch { /* se limpia al cerrar */ }
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { /* archivos en uso: el sistema limpia %TEMP% */ }
    }
}
