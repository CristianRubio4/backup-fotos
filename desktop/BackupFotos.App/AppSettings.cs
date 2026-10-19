using System.Text.Json;

namespace BackupFotos.App;

/// <summary>Ajustes guardados en %APPDATA%\BackupFotos\ajustes.json.</summary>
public sealed class AppSettings
{
    public string? Destination { get; set; }
    public string PcId { get; set; } = Guid.NewGuid().ToString();

    static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BackupFotos", "ajustes.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
        }
        catch
        {
            // Ajustes dañados: se empieza de cero.
        }
        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
        }
        catch
        {
            // No es grave: solo se pierde la carpeta recordada.
        }
    }
}
