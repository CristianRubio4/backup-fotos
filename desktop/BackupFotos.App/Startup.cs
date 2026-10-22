using Microsoft.Win32;

namespace BackupFotos.App;

/// <summary>Abrir el programa al iniciar Windows, en segundo plano (solo para este usuario, sin permisos de administrador).</summary>
static class Startup
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string Name = "BackupFotos";
    public const string BackgroundArg = "--segundo-plano";

    public static bool Enabled
    {
        get
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(Name) is string;
        }
    }

    public static void Set(bool on)
    {
        using var k = Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) k.SetValue(Name, $"\"{Environment.ProcessPath}\" {BackgroundArg}");
        else k.DeleteValue(Name, throwOnMissingValue: false);
    }
}