using System.Net;
using System.Text;
using System.Text.Json;
using BackupFotos.Core;

namespace BackupFotos.Tests;

public sealed class FakeHub(params FakePhone[] phones) : IDeviceHub
{
    public IReadOnlyList<DeviceInfo> List() => phones.Select((p, i) => new DeviceInfo($"dev-{i}", p.Name)).ToList();

    public void With(string deviceId, Action<IMediaSource> fn)
    {
        var i = int.Parse(deviceId["dev-".Length..]);
        if (i >= phones.Length) throw new FileNotFoundException("El móvil ya no está conectado.");
        lock (phones[i]) fn(phones[i]);
    }
}

public class ConnectorTests
{
    const string Web = "https://cristianrubio4.github.io";

    static (ConnectorServer Server, HttpClient Http, TempDir Cache) Start(params FakePhone[] phones)
    {
        var cache = new TempDir();
        var server = new ConnectorServer(new FakeHub(phones), port: 0, cacheDir: cache.Path, cacheBytes: 1 << 20);
        var http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{server.Port}") };
        return (server, http, cache);
    }

    static HttpRequestMessage Get(string url, string? origin = Web)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (origin is not null) req.Headers.Add("Origin", origin);
        return req;
    }

    [Fact]
    public async Task Lista_los_moviles_conectados()
    {
        var (server, http, cache) = Start(new FakePhone("Galaxy S23"));
        using var _ = server; using var __ = http; using var ___ = cache;
        var res = await http.SendAsync(Get("/v1/info"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(Web, res.Headers.GetValues("Access-Control-Allow-Origin").Single());
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal(ConnectorServer.AppId, doc.RootElement.GetProperty("app").GetString());
        var dev = doc.RootElement.GetProperty("devices")[0];
        Assert.Equal("dev-0", dev.GetProperty("id").GetString());
        Assert.Equal("Galaxy S23", dev.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Solo_responde_a_la_web_de_backup_de_fotos()
    {
        var (server, http, cache) = Start(new FakePhone().Add("DCIM/a.jpg", "privada"));
        using var _ = server; using var __ = http; using var ___ = cache;
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(Get("/v1/info", "https://otra-web.com"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(Get("/v1/info", origin: null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(Get("/v1/file?device=dev-0&path=DCIM%2Fa.jpg", "https://otra-web.com"))).StatusCode);
    }

    [Fact]
    public async Task Responde_a_la_comprobacion_previa_del_navegador()
    {
        var (server, http, cache) = Start(new FakePhone());
        using var _ = server; using var __ = http; using var ___ = cache;
        var req = new HttpRequestMessage(HttpMethod.Options, "/v1/info");
        req.Headers.Add("Origin", Web);
        req.Headers.Add("Access-Control-Request-Private-Network", "true");
        var res = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal("true", res.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
    }

    [Fact]
    public async Task Escanea_todo_el_movil_y_sirve_cada_archivo()
    {
        var phone = new FakePhone("Pixel 8")
            .Add("Interno/DCIM/Camera/IMG_1.jpg", "foto uno")
            .Add("Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA1.jpg", "whatsapp")
            .Add("Interno/Android/data/com.app/x.jpg", "interno")
            .Add("Interno/Download/doc.pdf", "pdf")
            .Add("SD/DCIM/Camera/VID_1.mp4", "vídeo en la tarjeta")
            .Add("Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Sent/IMG-S1.jpg", "enviada");
        var (server, http, cache) = Start(phone);
        using var _ = server; using var __ = http; using var ___ = cache;

        var res = await http.SendAsync(Get("/v1/scan?device=dev-0"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var lines = (await res.Content.ReadAsStringAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonDocument.Parse(l).RootElement).ToList();
        Assert.Equal("start", lines[0].GetProperty("t").GetString());
        var files = lines.Where(l => l.GetProperty("t").GetString() == "file").Select(l => l.GetProperty("path").GetString()).ToList();
        Assert.Equal(new[]
        {
            "Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA1.jpg",
            "Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Sent/IMG-S1.jpg",
            "Interno/DCIM/Camera/IMG_1.jpg",
            "SD/DCIM/Camera/VID_1.mp4",
        }, files.Order(StringComparer.Ordinal));
        // Lo enviado por WhatsApp va marcado: la web decide si lo copia.
        var sent = lines.Where(l => l.GetProperty("t").GetString() == "file" && l.GetProperty("sent").GetBoolean()).Select(l => l.GetProperty("path").GetString()).ToList();
        Assert.Equal(new[] { "Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Sent/IMG-S1.jpg" }, sent);
        var done = lines.Last();
        Assert.Equal("done", done.GetProperty("t").GetString());
        Assert.Equal("Pixel 8", done.GetProperty("name").GetString());
        Assert.Contains(lines, l => l.GetProperty("t").GetString() == "ignored" && l.GetProperty("path").GetString() == "Interno/Download/doc.pdf");

        // Rutas con espacios y caracteres especiales.
        var file = await http.SendAsync(Get("/v1/file?device=dev-0&path=" + Uri.EscapeDataString("Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA1.jpg")));
        Assert.Equal(HttpStatusCode.OK, file.StatusCode);
        Assert.Equal("whatsapp", await file.Content.ReadAsStringAsync());
        Assert.Equal("vídeo en la tarjeta", Encoding.UTF8.GetString(await (await http.SendAsync(Get("/v1/file?device=dev-0&path=" + Uri.EscapeDataString("SD/DCIM/Camera/VID_1.mp4")))).Content.ReadAsByteArrayAsync()));
    }

    [Fact]
    public async Task La_segunda_lectura_sale_de_la_cache_sin_volver_al_movil()
    {
        var phone = new FakePhone().Add("DCIM/a.jpg", "contenido");
        var (server, http, cache) = Start(phone);
        using var _ = server; using var __ = http; using var ___ = cache;
        await http.SendAsync(Get("/v1/scan?device=dev-0"));
        for (var i = 0; i < 3; i++)
            Assert.Equal("contenido", await (await http.SendAsync(Get("/v1/file?device=dev-0&path=DCIM%2Fa.jpg"))).Content.ReadAsStringAsync());
        Assert.Equal(1, phone.Copies);
    }

    [Fact]
    public async Task Archivos_grandes_llegan_completos()
    {
        var big = new byte[5 * 1024 * 1024 + 123];
        new Random(7).NextBytes(big);
        var (server, http, cache) = Start(new FakePhone().Add("DCIM/VID_grande.mp4", big));
        using var _ = server; using var __ = http; using var ___ = cache;
        var got = await (await http.SendAsync(Get("/v1/file?device=dev-0&path=DCIM%2FVID_grande.mp4"))).Content.ReadAsByteArrayAsync();
        Assert.Equal(big, got);
    }

    [Fact]
    public async Task Errores_claros_si_falta_el_movil_o_el_archivo()
    {
        var (server, http, cache) = Start(new FakePhone().Add("DCIM/a.jpg", "x"));
        using var _ = server; using var __ = http; using var ___ = cache;
        var noDevice = await http.SendAsync(Get("/v1/file?device=dev-5&path=DCIM%2Fa.jpg"));
        Assert.Equal(HttpStatusCode.NotFound, noDevice.StatusCode);
        Assert.Contains("no está conectado", await noDevice.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await http.SendAsync(Get("/v1/file?device=dev-0&path=DCIM%2Fno.jpg"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await http.SendAsync(Get("/v1/file?device=dev-0"))).StatusCode);
    }
}
