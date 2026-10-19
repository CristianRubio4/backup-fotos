using System.Globalization;
using System.Text.RegularExpressions;

namespace BackupFotos.Core;

/// <summary>Nombres de carpetas y archivos (los mismos que la web).</summary>
public static partial class Naming
{
    static readonly DateTime MinReliable = new(1990, 1, 1);

    /// <summary>Quita caracteres no válidos en Windows / FAT / exFAT y los puntos o espacios finales.</summary>
    public static string Sanitize(string name)
    {
        var s = InvalidChars().Replace(name, "_").TrimEnd('.', ' ');
        return s is "" or "." or ".." ? "archivo" : s;
    }

    /// <summary>"Galaxy S23 - 2026-10-19 14h30", o "Copia 2026-10-19 14h30" si no se sabe el nombre (sin ":", que Windows no admite).</summary>
    public static string RunFolderName(DateTime when, string? label)
    {
        var stamp = when.ToString("yyyy-MM-dd HH'h'mm", CultureInfo.InvariantCulture);
        var name = string.IsNullOrWhiteSpace(label) ? "" : Sanitize(label.Trim()).Trim();
        return name.Length > 0 ? $"{name} - {stamp}" : $"Copia {stamp}";
    }

    /// <summary>Fecha para el archivo: EXIF si es razonable; si no, la de modificación; si no, ninguna.</summary>
    public static (DateTime? Date, bool FromExif) PickDate(DateTime? exif, DateTime? modified, DateTime now)
    {
        if (exif is { } e && e >= MinReliable && e <= now.AddDays(1)) return (e, true);
        if (modified is { } m && m >= MinReliable && m <= now.AddDays(1)) return (m, false);
        return (null, false);
    }

    /// <summary>2026-10-09_143022_IMG_0001.jpg (si ya trae ese prefijo, no se repite).</summary>
    public static string DatedName(string name, DateTime? date)
    {
        var clean = Sanitize(name);
        if (date is null || DatedPrefix().IsMatch(clean)) return clean;
        return $"{date.Value.ToString("yyyy-MM-dd_HHmmss", CultureInfo.InvariantCulture)}_{clean}";
    }

    /// <summary>IMG.jpg → IMG_1.jpg, IMG_2.jpg…</summary>
    public static string WithSuffix(string name, int n)
    {
        if (n == 0) return name;
        var dot = name.LastIndexOf('.');
        return dot > 0 ? $"{name[..dot]}_{n}{name[dot..]}" : $"{name}_{n}";
    }

    /// <summary>Fecha local sin zona, como el EXIF: 2026-10-09T14:30:22.</summary>
    public static string LocalIso(DateTime d) => d.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    /// <summary>Fecha ISO en UTC, como Date.toISOString() de la web.</summary>
    public static string UtcIso(DateTime d) => d.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    [GeneratedRegex(@"[<>:""/\\|?*\x00-\x1f]")]
    private static partial Regex InvalidChars();

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}_\d{6}_")]
    private static partial Regex DatedPrefix();
}
