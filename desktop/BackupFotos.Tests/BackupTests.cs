using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BackupFotos.Core;

namespace BackupFotos.Tests;

public class BackupTests
{
    static readonly DateTime Now = new(2026, 10, 19, 14, 30, 5);

    static BackupResult Run(IMediaSource source, string dest, CancellationToken ct = default, bool verify = true) =>
        BackupEngine.Run(new BackupOptions
        {
            Source = source,
            DestinationRoot = dest,
            DeviceId = "pc-1",
            DeviceName = "PC de prueba",
            Now = () => Now,
            ReadDate = _ => null,
            Verify = verify,
        }, null, ct);

    static string Sha(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();

    static List<string> MediaFiles(string folder) =>
        Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
            .Select(f => Path.GetRelativePath(folder, f).Replace('\\', '/'))
            .Where(f => !Path.GetFileName(f).StartsWith('.'))
            .Order(StringComparer.Ordinal)
            .ToList();

    /// <summary>Un móvil Android típico, con fotos en muchas carpetas y a distintas profundidades.</summary>
    static FakePhone TypicalPhone()
    {
        var p = new FakePhone();
        for (var i = 0; i < 30; i++) p.Add($"Almacenamiento interno/DCIM/Camera/IMG_{i:000}.jpg", $"foto de cámara {i}");
        for (var i = 0; i < 5; i++) p.Add($"Almacenamiento interno/DCIM/Camera/VID_{i}.mp4", $"vídeo {i}");
        for (var i = 0; i < 8; i++) p.Add($"Almacenamiento interno/Pictures/Screenshots/Screenshot_{i}.png", $"captura {i}");
        p.Add("Almacenamiento interno/DCIM/100ANDRO/DSC_0001.JPG", "foto con extensión en mayúsculas");
        for (var i = 0; i < 6; i++) p.Add($"Almacenamiento interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA{i:0000}.jpg", $"whatsapp {i}");
        p.Add("Almacenamiento interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/Sent/IMG-WA-sent.jpg", "whatsapp enviada");
        p.Add("Almacenamiento interno/Android/data/com.juego/cache/textura.png", "dato interno de una app");
        p.Add("Almacenamiento interno/Android/obb/com.juego/asset.jpg", "dato interno");
        p.Add("Almacenamiento interno/DCIM/.thumbnails/t1.jpg", "miniatura");
        p.Add("Almacenamiento interno/Pictures/.trashed-123-IMG.jpg", "en la papelera");
        p.Add("Almacenamiento interno/Download/factura.pdf", "no es foto");
        p.Add("Almacenamiento interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers/st1.webp", "sticker");
        p.Add("Almacenamiento interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/escaneo.jpg", "documento");
        p.Add("Almacenamiento interno/Download/Viaje a Roma 2024.06/roma.jpeg", "carpeta con puntos");
        p.Add("Tarjeta SD/DCIM/Camera/IMG_SD.jpg", "foto en la tarjeta");
        return p;
    }

    [Fact]
    public void Encuentra_todas_las_fotos_de_todas_las_carpetas()
    {
        var scan = Scanner.Scan(TypicalPhone(), default);
        Assert.Equal(30 + 5 + 8 + 1 + 6 + 1 + 1, scan.Files.Count); // sin WhatsApp Images/Sent
        Assert.DoesNotContain(scan.Files, f => f.Path.Contains("/Sent/") || f.Path.Contains("Stickers") || f.Path.Contains("Documents"));
        Assert.Contains(scan.Files, f => f.Path == "Tarjeta SD/DCIM/Camera/IMG_SD.jpg");
        Assert.Contains(scan.Files, f => f.Path == "Almacenamiento interno/Download/Viaje a Roma 2024.06/roma.jpeg");
        Assert.DoesNotContain(scan.Files, f => f.Path.Contains("/Android/data/") || f.Path.Contains("/Android/obb/") || f.Path.Contains("/.thumbnails/"));
        Assert.DoesNotContain(scan.Files, f => f.Name.StartsWith('.'));
        Assert.Equal(new[] { "Almacenamiento interno/Download/factura.pdf" }, scan.Ignored.Where(i => !i.Contains("/Android/")).Where(i => !Path.GetFileName(i).StartsWith('.')));
        Assert.Contains("Galaxy S23/Almacenamiento interno/DCIM/Camera · 35 fotos y vídeos de 35 archivos", scan.Dirs);
    }

    [Fact]
    public void Recorre_carpetas_muy_anidadas()
    {
        var p = new FakePhone();
        var path = string.Join('/', Enumerable.Range(1, 40).Select(i => $"n{i}"));
        p.Add($"{path}/profunda.jpg", "muy adentro");
        var scan = Scanner.Scan(p, default);
        Assert.Single(scan.Files);
        Assert.Equal(41, scan.Dirs.Count);
    }

    [Fact]
    public void Copia_todo_en_una_sola_carpeta_con_el_nombre_del_movil_y_la_fecha()
    {
        using var dest = new TempDir();
        var r = Run(TypicalPhone(), dest.Path);
        Assert.Equal(Outcome.Completed, r.Outcome);
        Assert.Equal(52, r.Copied);
        Assert.Empty(r.Errors);
        // Una sola carpeta en el destino; nada más.
        Assert.Equal(new[] { "Galaxy S23 - 2026-10-19 14h30" }, Directory.EnumerateFileSystemEntries(dest.Path).Select(Path.GetFileName));
        var folder = Path.Combine(dest.Path, "Galaxy S23 - 2026-10-19 14h30");
        Assert.Equal(r.Folder, folder);
        Assert.Equal(52, MediaFiles(folder).Count);
        // Los archivos de control, dentro de la carpeta de la copia.
        Assert.True(File.Exists(Path.Combine(folder, ".backup-disk-id")));
        Assert.True(File.Exists(Path.Combine(folder, ".backup-manifest.json")));
        Assert.Empty(Directory.EnumerateFiles(folder, "*.part", SearchOption.AllDirectories));
        Assert.Empty(Directory.EnumerateFiles(folder, ".*.part"));
    }

    [Fact]
    public void Las_copias_son_identicas_al_original_con_la_misma_estructura_y_fecha()
    {
        using var dest = new TempDir();
        var p = new FakePhone().Add("DCIM/Camera/IMG_1.jpg", "contenido de la foto 1");
        var r = Run(p, dest.Path);
        var file = Path.Combine(r.Folder!, "DCIM", "Camera", "IMG_1.jpg");
        Assert.Equal("contenido de la foto 1", File.ReadAllText(file));
        Assert.Equal(new DateTime(2024, 5, 17, 10, 30, 0), File.GetLastWriteTime(file));
    }

    [Fact]
    public void El_registro_es_compatible_con_la_web()
    {
        using var dest = new TempDir();
        var r = Run(new FakePhone().Add("DCIM/a.jpg", "foto a").Add("DCIM/b.mp4", "vídeo b"), dest.Path);
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(r.Folder!, ".backup-manifest.json")));
        var root = doc.RootElement;
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        var diskId = root.GetProperty("diskId").GetString();
        using var id = JsonDocument.Parse(File.ReadAllText(Path.Combine(r.Folder!, ".backup-disk-id")));
        Assert.Equal(diskId, id.RootElement.GetProperty("id").GetString());
        var entries = root.GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(2, entries.Count);
        var a = entries.First(e => e.GetProperty("originalName").GetString() == "a.jpg");
        Assert.Equal(Sha("foto a"), a.GetProperty("hash").GetString());
        Assert.Matches("^[0-9a-f]{64}$", a.GetProperty("hash").GetString());
        Assert.Equal("DCIM/a.jpg", a.GetProperty("diskPath").GetString());
        Assert.Equal("Galaxy S23/DCIM/a.jpg", a.GetProperty("sourcePath").GetString());
        Assert.Equal("verified", a.GetProperty("status").GetString());
        // La web exige exifDate presente (null o texto) y note ausente si no hay nota.
        Assert.Equal(JsonValueKind.Null, a.GetProperty("exifDate").ValueKind);
        Assert.False(a.TryGetProperty("note", out _));
        foreach (var key in new[] { "size", "fileDate", "deviceId", "deviceName", "copiedAt" }) Assert.True(a.TryGetProperty(key, out _), key);
    }

    [Fact]
    public void Con_fecha_EXIF_se_usa_esa_fecha()
    {
        using var dest = new TempDir();
        var r = BackupEngine.Run(new BackupOptions
        {
            Source = new FakePhone().Add("DCIM/IMG_9.jpg", "x"),
            DestinationRoot = dest.Path,
            Now = () => Now,
            ReadDate = _ => new DateTime(2023, 1, 2, 3, 4, 5),
        }, null, default);
        Assert.Equal(new[] { "DCIM/IMG_9.jpg" }, MediaFiles(r.Folder!));
        var m = ControlFiles.Load(r.Folder!)!;
        Assert.Equal("2023-01-02T03:04:05", m.Entries[0].ExifDate);
    }

    [Fact]
    public void Lee_la_fecha_EXIF_de_una_foto_real()
    {
        var jpg = Path.Combine(RepoRoot(), "tests", "fixtures", "set", "DCIM", "IMG_0001.jpg");
        Assert.NotNull(ExifDate.Read(jpg));
        Assert.Null(ExifDate.Read(Path.Combine(RepoRoot(), "tests", "fixtures", "set", "notas.txt")));
    }

    [Fact]
    public void Una_carpeta_de_fotos_real_se_copia_entera_y_verificada()
    {
        using var dest = new TempDir();
        var set = Path.Combine(RepoRoot(), "tests", "fixtures", "set");
        var r = BackupEngine.Run(new BackupOptions { Source = new FolderSource(set, "Fotos de prueba"), DestinationRoot = dest.Path, Now = () => Now }, null, default);
        Assert.Equal(Outcome.Completed, r.Outcome);
        var media = Directory.EnumerateFiles(set, "*", SearchOption.AllDirectories).Count(f => Media.IsMedia(Path.GetFileName(f)));
        var empty = Directory.EnumerateFiles(set, "*", SearchOption.AllDirectories).Count(f => Media.IsMedia(Path.GetFileName(f)) && new FileInfo(f).Length == 0);
        // Todo lo que es foto o vídeo, salvo los vacíos (también las repetidas, cada una en su sitio).
        Assert.Equal(media - empty, r.Copied);
        Assert.Empty(r.Duplicates);
        Assert.Equal(empty, r.EmptyFiles.Count);
        Assert.Equal(r.Copied, MediaFiles(r.Folder!).Count);
        // Misma estructura de carpetas y nombres que en el origen.
        Assert.Contains("DCIM/IMG_0002.jpg", MediaFiles(r.Folder!));
    }

    [Fact]
    public void Una_foto_repetida_en_otra_carpeta_se_copia_tambien_alli()
    {
        using var dest = new TempDir();
        var p = new FakePhone().Add("DCIM/IMG_1.jpg", "misma foto").Add("WhatsApp/IMG-WA1.jpg", "misma foto").Add("DCIM/IMG_2.jpg", "otra");
        var r = Run(p, dest.Path);
        Assert.Equal(3, r.Copied);
        Assert.Empty(r.Duplicates);
        Assert.Equal(new[] { "DCIM/IMG_1.jpg", "DCIM/IMG_2.jpg", "WhatsApp/IMG-WA1.jpg" }, MediaFiles(r.Folder!));
        Assert.Equal(3, ControlFiles.Load(r.Folder!)!.Entries.Count);
    }

    [Fact]
    public void Archivos_con_el_mismo_nombre_en_carpetas_distintas_conservan_su_carpeta()
    {
        using var dest = new TempDir();
        var p = new FakePhone().Add("DCIM/A/IMG_1.jpg", "uno").Add("DCIM/B/IMG_1.jpg", "dos").Add("DCIM/C/IMG_1.jpg", "tres");
        var r = Run(p, dest.Path);
        Assert.Equal(new[] { "DCIM/A/IMG_1.jpg", "DCIM/B/IMG_1.jpg", "DCIM/C/IMG_1.jpg" }, MediaFiles(r.Folder!));
        Assert.Equal(new[] { "uno", "dos", "tres" }.Order(), MediaFiles(r.Folder!).Select(f => File.ReadAllText(Path.Combine(r.Folder!, f))).Order());
    }

    [Fact]
    public void Cada_backup_es_una_copia_completa_en_su_propia_carpeta()
    {
        using var dest = new TempDir();
        var p = new FakePhone().Add("DCIM/IMG_1.jpg", "a");
        var r1 = Run(p, dest.Path);
        p.Add("DCIM/IMG_2.jpg", "b");
        var r2 = Run(p, dest.Path); // misma hora: no se mezcla con la anterior
        Assert.NotEqual(r1.Folder, r2.Folder);
        Assert.EndsWith("Galaxy S23 - 2026-10-19 14h30 (2)", r2.Folder);
        Assert.Single(MediaFiles(r1.Folder!));
        Assert.Equal(2, MediaFiles(r2.Folder!).Count);
    }

    [Fact]
    public void Una_carpeta_ilegible_o_un_archivo_que_falla_no_detienen_el_resto()
    {
        using var dest = new TempDir();
        var p = new FakePhone().Add("DCIM/ok1.jpg", "1").Add("DCIM/mal.jpg", "x").Add("Privada/secreta.jpg", "s").Add("Pictures/ok2.jpg", "2");
        p.BrokenDirs.Add("Privada");
        p.BrokenFiles.Add("DCIM/mal.jpg");
        var r = Run(p, dest.Path);
        Assert.Equal(Outcome.Completed, r.Outcome);
        Assert.Equal(2, r.Copied);
        Assert.Equal(2, r.Errors.Count);
        Assert.Contains(r.Errors, e => e.Path == "Privada");
        Assert.Contains(r.Errors, e => e.Path == "DCIM/mal.jpg");
        Assert.Empty(Directory.EnumerateFiles(r.Folder!, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public void Si_el_movil_se_desconecta_lo_copiado_queda_guardado()
    {
        using var dest = new TempDir();
        var p = new FakePhone();
        for (var i = 0; i < 10; i++) p.Add($"DCIM/IMG_{i}.jpg", $"foto {i}");
        p.DisconnectAfter = 4;
        var r = Run(p, dest.Path);
        Assert.Equal(Outcome.SourceDisconnected, r.Outcome);
        Assert.Equal(4, r.Copied);
        Assert.Equal(4, ControlFiles.Load(r.Folder!)!.Entries.Count);
        Assert.Equal(4, MediaFiles(r.Folder!).Count);
    }

    [Fact]
    public void Cancelar_guarda_el_registro_de_lo_copiado()
    {
        using var dest = new TempDir();
        using var cts = new CancellationTokenSource();
        var p = new FakePhone();
        for (var i = 0; i < 10; i++) p.Add($"DCIM/IMG_{i}.jpg", $"foto {i}");
        var copied = 0;
        var r = BackupEngine.Run(new BackupOptions
        {
            Source = p,
            DestinationRoot = dest.Path,
            Now = () => Now,
            ReadDate = _ => { if (++copied == 3) cts.Cancel(); return null; },
        }, null, cts.Token);
        Assert.Equal(Outcome.Cancelled, r.Outcome);
        Assert.Equal(r.Copied, ControlFiles.Load(r.Folder!)!.Entries.Count);
        Assert.Equal(r.Copied, MediaFiles(r.Folder!).Count);
        Assert.Empty(Directory.EnumerateFiles(r.Folder!, "*.part", SearchOption.AllDirectories));
    }

    [Fact]
    public void Si_el_movil_no_responde_desde_el_principio_no_se_crea_nada()
    {
        using var dest = new TempDir();
        var p = new FakePhone();
        p.BrokenDirs.Add("");
        var r = Run(p, dest.Path);
        Assert.Equal(Outcome.SourceDisconnected, r.Outcome);
        Assert.Empty(Directory.EnumerateFileSystemEntries(dest.Path));
    }

    [Fact]
    public void Los_archivos_vacios_no_se_copian_y_se_avisa()
    {
        using var dest = new TempDir();
        var r = Run(new FakePhone().Add("DCIM/vacia.jpg", "").Add("DCIM/ok.jpg", "ok"), dest.Path);
        Assert.Equal(1, r.Copied);
        Assert.Equal(new[] { "DCIM/vacia.jpg" }, r.EmptyFiles);
    }

    [Theory]
    [InlineData("Galaxy S23", "Galaxy S23 - 2026-10-19 14h30")]
    [InlineData("Móvil: \"Ana\"", "Móvil_ _Ana_ - 2026-10-19 14h30")]
    [InlineData("", "Copia 2026-10-19 14h30")]
    [InlineData(null, "Copia 2026-10-19 14h30")]
    public void Nombre_de_la_carpeta(string? device, string expected) => Assert.Equal(expected, Naming.RunFolderName(Now, device));

    [Fact]
    public void Fechas_poco_fiables_no_se_usan()
    {
        Assert.Null(Naming.PickDate(new DateTime(1980, 1, 1), new DateTime(1970, 1, 1), Now).Date);
        Assert.Equal(new DateTime(2024, 1, 1), Naming.PickDate(null, new DateTime(2024, 1, 1), Now).Date);
        Assert.Equal("IMG.jpg", Naming.DatedName("IMG.jpg", null));
        Assert.Equal("2024-01-01_000000_IMG.jpg", Naming.DatedName("2024-01-01_000000_IMG.jpg", new DateTime(2025, 1, 1)));
    }

    static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "tests", "fixtures", "set"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("No se encuentra tests/fixtures/set");
    }
}
