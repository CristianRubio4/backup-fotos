using System.Diagnostics;
using System.Runtime.InteropServices;
using BackupFotos.Core;
using MediaDevices;

namespace BackupFotos.App;

/// <summary>Ventana principal: elegir móvil y destino, hacer el backup y ver el resultado.</summary>
public sealed class MainForm : Form
{
    static readonly Color Accent = Color.FromArgb(37, 99, 235);
    static readonly Color Muted = Color.FromArgb(100, 116, 139);
    static readonly Color Ok = Color.FromArgb(22, 163, 74);
    static readonly Color Bad = Color.FromArgb(220, 38, 38);

    readonly AppSettings _settings = AppSettings.Load();
    readonly MtpHub _hub = new();
    ConnectorServer? _server;
    readonly Label _connector = new()
    {
        AutoSize = true,
        Dock = DockStyle.Top,
        Padding = new Padding(12, 10, 12, 10),
        Margin = new Padding(0, 4, 0, 8),
        MaximumSize = new Size(620, 0),
    };
    readonly ComboBox _devices = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill, Margin = new Padding(0, 4, 8, 4) };
    readonly Button _refresh = MakeButton("Buscar de nuevo");
    readonly Label _deviceHint = Hint("");
    readonly TextBox _dest = new() { ReadOnly = true, Dock = DockStyle.Fill, Margin = new Padding(0, 4, 8, 4), BackColor = SystemColors.Window };
    readonly Button _choose = MakeButton("Elegir…");
    readonly Button _start = new()
    {
        Text = "Hacer backup",
        Height = 48,
        Dock = DockStyle.Top,
        FlatStyle = FlatStyle.Flat,
        BackColor = Accent,
        ForeColor = Color.White,
        Font = new Font("Segoe UI Semibold", 12f),
        Cursor = Cursors.Hand,
        Margin = new Padding(0, 16, 0, 8),
    };
    readonly ProgressBar _bar = new() { Dock = DockStyle.Top, Height = 10, Style = ProgressBarStyle.Continuous, Visible = false, Margin = new Padding(0, 8, 0, 4) };
    readonly Label _status = new() { Dock = DockStyle.Top, AutoSize = true, Font = new Font("Segoe UI Semibold", 10.5f), Margin = new Padding(0, 8, 0, 0) };
    readonly Label _detail = Hint("");
    readonly FlowLayoutPanel _resultButtons = new() { Dock = DockStyle.Top, AutoSize = true, Visible = false, Margin = new Padding(0, 8, 0, 0) };
    readonly Button _open = MakeButton("Abrir la carpeta");
    readonly Button _details = MakeButton("Ver detalles");

    CancellationTokenSource? _cts;
    BackupResult? _last;
    System.Windows.Forms.Timer? _refreshDebounce;

    public MainForm()
    {
        Text = "Backup de fotos";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(680, 560);
        MinimumSize = new Size(560, 520);
        BackColor = Color.White;
        Padding = new Padding(28, 24, 28, 24);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* sin icono */ }

        _start.FlatAppearance.BorderSize = 0;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoScroll = true };
        layout.Controls.Add(new Label { Text = "Backup de fotos del móvil", AutoSize = true, Font = new Font("Segoe UI Semibold", 18f) });
        layout.Controls.Add(Hint("Copia TODAS las fotos y vídeos del móvil (todas sus carpetas) en una carpeta nueva con el nombre del móvil y la fecha y hora. Cada archivo se verifica. En el móvil no se borra ni se cambia nada."));
        layout.Controls.Add(_connector);
        StartConnector();

        layout.Controls.Add(SectionTitle("1. Móvil"));
        layout.Controls.Add(Row(_devices, _refresh));
        layout.Controls.Add(_deviceHint);

        layout.Controls.Add(SectionTitle("2. Dónde guardar"));
        layout.Controls.Add(Row(_dest, _choose));
        layout.Controls.Add(Hint("Un disco externo o una carpeta del PC. Dentro se crea una sola carpeta por backup, con todo dentro."));

        layout.Controls.Add(_start);
        layout.Controls.Add(_bar);
        layout.Controls.Add(_status);
        layout.Controls.Add(_detail);
        _resultButtons.Controls.Add(_open);
        _resultButtons.Controls.Add(_details);
        layout.Controls.Add(_resultButtons);
        Controls.Add(layout);

        _dest.Text = _settings.Destination ?? "";
        _refresh.Click += (_, _) => LoadDevices();
        _choose.Click += (_, _) => ChooseDestination();
        _start.Click += (_, _) => { if (_cts is null) StartBackup(); else _cts.Cancel(); };
        _open.Click += (_, _) => { if (_last?.Folder is { } f && Directory.Exists(f)) Process.Start("explorer.exe", $"\"{f}\""); };
        _details.Click += (_, _) => ShowDetails();
        _devices.SelectedIndexChanged += (_, _) => UpdateReady();
        Shown += (_, _) => LoadDevices();
        FormClosing += OnClosing;
        UpdateReady();
    }

    // ---- Controles ----

    static Button MakeButton(string text)
    {
        var b = new Button { Text = text, AutoSize = true, Height = 32, FlatStyle = FlatStyle.System, Margin = new Padding(0, 4, 8, 4), Padding = new Padding(10, 2, 10, 2) };
        return b;
    }

    static Label Hint(string text) => new() { Text = text, AutoSize = true, ForeColor = Muted, MaximumSize = new Size(620, 0), Margin = new Padding(0, 2, 0, 4) };

    static Label SectionTitle(string text) => new() { Text = text, AutoSize = true, Font = new Font("Segoe UI Semibold", 11f), Margin = new Padding(0, 18, 0, 2) };

    static TableLayoutPanel Row(Control main, Control side)
    {
        var row = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Top, AutoSize = true, Margin = new Padding(0) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.Controls.Add(main, 0, 0);
        row.Controls.Add(side, 1, 0);
        return row;
    }

    sealed record DeviceItem(string Id, string Name)
    {
        public override string ToString() => Name;
    }

    // ---- Conector para la web ----

    /// <summary>
    /// Mientras esta ventana esté abierta, la web (cristianrubio4.github.io) puede leer el
    /// móvil por cable a través de 127.0.0.1. Solo desde este PC y solo esa web.
    /// </summary>
    void StartConnector()
    {
        try
        {
            _server = new ConnectorServer(_hub, version: Application.ProductVersion);
            _server.Activity += a => { try { BeginInvoke(new Action(() => SetConnector(true, a))); } catch { /* cerrando */ } };
            SetConnector(true, null);
        }
        catch (System.Net.Sockets.SocketException)
        {
            SetConnector(false, "Ya hay otra ventana de Backup de fotos abierta: la web usará esa.");
        }
    }

    void SetConnector(bool on, string? activity)
    {
        _connector.BackColor = on ? Color.FromArgb(236, 253, 243) : Color.FromArgb(254, 243, 199);
        _connector.ForeColor = on ? Color.FromArgb(21, 128, 61) : Color.FromArgb(146, 64, 14);
        _connector.Text = on
            ? "● Conector para la web activo. Puedes hacer el backup desde la web (Fotos que copiar → Móvil por cable) mientras esta ventana esté abierta, o desde aquí mismo."
              + (activity is null ? "" : $"\nAhora: {activity}")
            : $"● {activity}";
    }

    // ---- Móviles conectados ----

    async void LoadDevices()
    {
        var previous = (_devices.SelectedItem as DeviceItem)?.Id;
        IReadOnlyList<DeviceInfo> found = [];
        try
        {
            found = await Task.Run(() => _hub.List());
        }
        catch (Exception ex)
        {
            _deviceHint.Text = $"No se pueden listar los dispositivos: {ex.Message}";
        }
        _devices.Items.Clear();
        foreach (var d in found) _devices.Items.Add(new DeviceItem(d.Id, d.Name));
        if (_devices.Items.Count > 0)
        {
            var again = _devices.Items.Cast<DeviceItem>().FirstOrDefault(d => d.Id == previous);
            _devices.SelectedItem = again ?? _devices.Items[0];
            _deviceHint.Text = "Si tu móvil no aparece: desbloquéalo y, en el aviso USB del móvil, elige \"Transferencia de archivos\".";
            _deviceHint.ForeColor = Muted;
        }
        else
        {
            _deviceHint.Text = "No hay ningún móvil conectado. Conéctalo por cable, desbloquéalo y elige \"Transferencia de archivos\" en el aviso USB del móvil. Aparecerá aquí solo.";
            _deviceHint.ForeColor = Bad;
        }
        UpdateReady();
    }

    /// <summary>Al conectar o desconectar un USB, se actualiza la lista sola.</summary>
    protected override void WndProc(ref Message m)
    {
        const int WM_DEVICECHANGE = 0x0219;
        if (m.Msg == WM_DEVICECHANGE && _cts is null)
        {
            _refreshDebounce ??= new System.Windows.Forms.Timer { Interval = 1500 };
            _refreshDebounce.Stop();
            _refreshDebounce.Tick -= OnDebounce;
            _refreshDebounce.Tick += OnDebounce;
            _refreshDebounce.Start();
        }
        base.WndProc(ref m);
    }

    void OnDebounce(object? sender, EventArgs e)
    {
        _refreshDebounce?.Stop();
        if (_cts is null) LoadDevices();
    }

    void ChooseDestination()
    {
        using var dlg = new FolderBrowserDialog
        {
            Description = "Elige dónde guardar el backup (dentro se creará una carpeta por cada copia)",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
            SelectedPath = Directory.Exists(_dest.Text) ? _dest.Text : "",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        _dest.Text = dlg.SelectedPath;
        _settings.Destination = dlg.SelectedPath;
        _settings.Save();
        UpdateReady();
    }

    void UpdateReady()
    {
        var running = _cts is not null;
        _start.Enabled = running || (_devices.SelectedItem is not null && _dest.Text.Length > 0);
        _start.BackColor = _start.Enabled ? (running ? Bad : Accent) : Color.FromArgb(203, 213, 225);
        _devices.Enabled = _refresh.Enabled = _choose.Enabled = !running;
    }

    // ---- Backup ----

    void StartBackup()
    {
        if (_devices.SelectedItem is not DeviceItem device) return;
        var dest = _dest.Text;
        if (!Directory.Exists(dest))
        {
            MessageBox.Show(this, "La carpeta de destino no existe o el disco no está conectado. Elige otra.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        _cts = new CancellationTokenSource();
        _last = null;
        _resultButtons.Visible = false;
        _bar.Visible = true;
        _bar.Value = 0;
        _start.Text = "Cancelar";
        _status.ForeColor = Color.Black;
        _status.Text = "Buscando fotos en todas las carpetas del móvil…";
        _detail.Text = "";
        UpdateReady();
        KeepAwake(true);

        var ct = _cts.Token;
        var progress = new Progress<BackupProgress>(ShowProgress);
        // El acceso al móvil (WPD, COM) va por el hilo de los dispositivos; aquí solo se espera sin bloquear la ventana.
        var thread = new Thread(() =>
        {
            BackupResult result = new() { Outcome = Outcome.Failed, Failure = "El móvil ya no está conectado." };
            try
            {
                _hub.With(device.Id, source =>
                {
                    result = BackupEngine.Run(new BackupOptions
                    {
                        Source = source,
                        DestinationRoot = dest,
                        DeviceId = _settings.PcId,
                        DeviceName = Environment.MachineName,
                    }, progress, ct);
                });
            }
            catch (Exception ex)
            {
                result = new BackupResult { Outcome = Outcome.Failed, Failure = ex.Message };
            }
            try
            {
                BeginInvoke(new Action(() => Finish(result)));
            }
            catch (InvalidOperationException)
            {
                // La ventana ya se cerró.
            }
        })
        { IsBackground = true, Name = "Backup" };
        thread.Start();
    }

    void ShowProgress(BackupProgress p)
    {
        if (_cts is null) return; // un aviso que llega después de terminar
        switch (p.Phase)
        {
            case Phase.Scanning:
                _bar.Style = ProgressBarStyle.Marquee;
                _status.Text = $"Buscando fotos en todas las carpetas del móvil… {p.FilesFound:N0} encontradas";
                _detail.Text = $"{p.DirsScanned:N0} carpetas revisadas · {p.Current}";
                break;
            case Phase.Copying or Phase.Verifying:
                _bar.Style = ProgressBarStyle.Continuous;
                var pct = p.BytesTotal > 0 ? (int)Math.Min(100, p.BytesDone * 100 / p.BytesTotal) : 0;
                _bar.Value = pct;
                var eta = p.BytesPerSecond > 0 ? TimeSpan.FromSeconds((p.BytesTotal - p.BytesDone) / p.BytesPerSecond) : (TimeSpan?)null;
                _status.Text = $"{(p.Phase == Phase.Verifying ? "Verificando" : "Copiando")} {p.FilesDone + 1:N0} de {p.FilesTotal:N0} · {pct}%";
                _detail.Text = $"{p.Current}\n{Bytes(p.BytesPerSecond)}/s{(eta is { } e ? $" · quedan {Duration(e)}" : "")}";
                break;
            case Phase.Saving:
                _status.Text = "Guardando el registro de la copia…";
                break;
        }
    }

    void Finish(BackupResult r)
    {
        _last = r;
        _cts?.Dispose();
        _cts = null;
        KeepAwake(false);
        _bar.Visible = false;
        _start.Text = "Hacer backup";
        UpdateReady();

        var lines = new List<string>();
        (_status.Text, _status.ForeColor) = r.Outcome switch
        {
            Outcome.Completed => ($"Backup terminado: {r.Copied:N0} fotos y vídeos copiados y verificados", Ok),
            Outcome.Cancelled => ($"Cancelado. Lo copiado ({r.Copied:N0}) está guardado y verificado.", Color.DarkOrange),
            Outcome.SourceDisconnected => (r.Failure ?? "El móvil se ha desconectado.", Bad),
            Outcome.DiskFull => (r.Failure ?? "El disco está lleno.", Bad),
            _ => ($"El backup se detuvo: {r.Failure}", Bad),
        };
        if (r.Folder is not null) lines.Add($"Carpeta: {r.Folder}");
        lines.Add($"{r.Found:N0} fotos y vídeos encontrados en {r.Dirs.Count:N0} carpetas · {Bytes(r.BytesCopied)} copiados en {Duration(r.Elapsed)}");
        if (r.Duplicates.Count > 0) lines.Add($"{r.Duplicates.Count:N0} repetidos dentro del móvil (mismo contenido): se han copiado una sola vez.");
        if (r.EmptyFiles.Count > 0) lines.Add($"{r.EmptyFiles.Count:N0} archivos vacíos (0 bytes) no se han copiado.");
        if (r.Errors.Count > 0) lines.Add($"{r.Errors.Count:N0} no se han podido copiar: pulsa \"Ver detalles\". Siguen en el móvil.");
        _detail.Text = string.Join("\n", lines);
        _resultButtons.Visible = r.Folder is not null || r.Dirs.Count > 0;
        _open.Visible = r.Folder is not null;
        if (r.Outcome == Outcome.Completed) System.Media.SystemSounds.Asterisk.Play();
    }

    void ShowDetails()
    {
        if (_last is not { } r) return;
        var text = new System.Text.StringBuilder();
        if (r.Errors.Count > 0)
        {
            text.AppendLine($"NO COPIADOS ({r.Errors.Count}) — siguen en el móvil:");
            foreach (var e in r.Errors) text.AppendLine($"  {e.Path}: {e.Reason}");
            text.AppendLine();
        }
        if (r.Duplicates.Count > 0)
        {
            text.AppendLine($"REPETIDOS ({r.Duplicates.Count}) — copiados una vez:");
            foreach (var d in r.Duplicates) text.AppendLine($"  {d.Path}: {d.Reason}");
            text.AppendLine();
        }
        text.AppendLine($"CARPETAS REVISADAS ({r.Dirs.Count}):");
        foreach (var d in r.Dirs) text.AppendLine($"  {d}");
        if (r.Ignored.Count > 0)
        {
            text.AppendLine();
            text.AppendLine($"OTROS ARCHIVOS QUE NO SON FOTOS NI VÍDEOS ({r.Ignored.Count}), no copiados:");
            foreach (var i in r.Ignored.Take(500)) text.AppendLine($"  {i}");
        }
        using var f = new Form { Text = "Detalles del backup", ClientSize = new Size(760, 520), StartPosition = FormStartPosition.CenterParent, Icon = Icon };
        f.Controls.Add(new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 9.5f), Text = text.ToString(), BackColor = Color.White });
        f.ShowDialog(this);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _server?.Dispose();
        _hub.Dispose();
        base.OnFormClosed(e);
    }

    void OnClosing(object? sender, FormClosingEventArgs e)
    {
        if (_cts is null) return;
        if (MessageBox.Show(this, "Hay un backup en marcha. ¿Cancelarlo y salir? Lo ya copiado queda guardado y verificado.", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
        {
            e.Cancel = true;
            return;
        }
        _cts.Cancel();
    }

    // ---- Utilidades ----

    static string Bytes(double b)
    {
        string[] u = ["B", "KB", "MB", "GB", "TB"];
        var i = 0;
        while (b >= 1024 && i < u.Length - 1) { b /= 1024; i++; }
        return $"{b:0.#} {u[i]}";
    }

    static string Duration(TimeSpan t) => t.TotalHours >= 1 ? $"{(int)t.TotalHours} h {t.Minutes} min" : t.TotalMinutes >= 1 ? $"{(int)t.TotalMinutes} min {t.Seconds} s" : $"{Math.Max(1, t.Seconds)} s";

    /// <summary>Que el PC no se suspenda durante el backup.</summary>
    static void KeepAwake(bool on) => SetThreadExecutionState(on ? 0x80000001u : 0x80000000u); // ES_CONTINUOUS | ES_SYSTEM_REQUIRED

    [DllImport("kernel32.dll")]
    static extern uint SetThreadExecutionState(uint flags);
}
