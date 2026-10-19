using MetadataExtractor;
using MetadataExtractor.Formats.Exif;
using MetadataExtractor.Formats.QuickTime;

namespace BackupFotos.Core;

/// <summary>Fecha de captura de una foto (EXIF) o vídeo (cabecera QuickTime/MP4).</summary>
public static class ExifDate
{
    public static DateTime? Read(string path)
    {
        try
        {
            var dirs = ImageMetadataReader.ReadMetadata(path);
            foreach (var d in dirs.OfType<ExifSubIfdDirectory>())
            {
                if (d.TryGetDateTime(ExifDirectoryBase.TagDateTimeOriginal, out var dt)) return dt;
                if (d.TryGetDateTime(ExifDirectoryBase.TagDateTimeDigitized, out dt)) return dt;
            }
            foreach (var d in dirs.OfType<ExifIfd0Directory>())
                if (d.TryGetDateTime(ExifDirectoryBase.TagDateTime, out var dt)) return dt;
            foreach (var d in dirs.OfType<QuickTimeMovieHeaderDirectory>())
                if (d.TryGetDateTime(QuickTimeMovieHeaderDirectory.TagCreated, out var dt)) return dt.ToLocalTime();
        }
        catch
        {
            // Formato no reconocido o archivo dañado: se usará la fecha del archivo.
        }
        return null;
    }
}
