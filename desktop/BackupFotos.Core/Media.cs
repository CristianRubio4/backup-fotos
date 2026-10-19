using System.Text.RegularExpressions;

namespace BackupFotos.Core;

/// <summary>Qué es una foto o vídeo y qué carpetas no se recorren (las mismas reglas que la web).</summary>
public static partial class Media
{
    static readonly HashSet<string> Images = new(StringComparer.OrdinalIgnoreCase)
    {
        "jpg", "jpeg", "jpe", "png", "heic", "heif", "avif", "webp", "gif", "bmp", "tif", "tiff", "jxl",
        "dng", "raw", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "srw", "x3f", "3fr", "iiq",
    };

    static readonly HashSet<string> Videos = new(StringComparer.OrdinalIgnoreCase)
    {
        "mp4", "mov", "m4v", "3gp", "3g2", "avi", "mkv", "webm", "mts", "m2ts", "mpg", "mpeg", "wmv", "insv", "lrv",
    };

    static readonly HashSet<string> SystemDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "$recycle.bin", "system volume information", "lost.dir",
        // Carpetas de un móvil que nunca tienen fotos ni vídeos del usuario: no se recorren (por cable, cada carpeta cuesta).
        "Music", "Ringtones", "Notifications", "Alarms", "Podcasts", "Audiobooks", "Recordings",
        "WhatsApp Voice Notes", "WhatsApp Audio", "WhatsApp Databases", "WhatsApp Backup Excluded Stickers",
    };

    public static string Ext(string name)
    {
        var dot = name.LastIndexOf('.');
        return dot > 0 ? name[(dot + 1)..].ToLowerInvariant() : "";
    }

    public static bool IsMedia(string name) => !name.StartsWith('.') && (Images.Contains(Ext(name)) || Videos.Contains(Ext(name)));

    public static bool IsVideo(string name) => Videos.Contains(Ext(name));

    /// <summary>
    /// ¿Saltar esta carpeta? Las del sistema, las ocultas (.thumbnails, .trashed…) y,
    /// en un móvil, Android/data y Android/obb (datos internos de las apps). Android/media
    /// sí se recorre: ahí están las fotos de WhatsApp.
    /// </summary>
    public static bool SkipDir(string name, string relPath) =>
        name.StartsWith('.') || name.StartsWith('$') || SystemDirs.Contains(name) || AndroidPrivate().IsMatch(relPath);

    [GeneratedRegex(@"(^|/)android/(data|obb)$", RegexOptions.IgnoreCase)]
    private static partial Regex AndroidPrivate();
}
