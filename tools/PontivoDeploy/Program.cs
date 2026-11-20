using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PontivoDeploy
{
    /// <summary>
    /// Oberfläche zum Ausrollen von Pontivo: auf int (Test) und von int auf prod (echt).
    /// Jede Person hat einen eigenen SSH-Schlüssel (nur zum Ausrollen) und ein eigenes Passwort.
    /// Der Server (deploy-gate.sh) prüft das Passwort und führt nur test, status, int, prod aus.
    /// Das Passwort wird nie gespeichert.
    /// </summary>
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    /// <summary>Farben nach Windows-Einstellung (hell/dunkel), inklusive dunkler Titelleiste.</summary>
    internal static class Theme
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public static bool Dark;
        public static Color Bg, Fg, Muted, InputBg, Border, BtnBg, BtnFg, LogBg, LogFg, Link, Ok, Bad, Busy, Disabled;

        public static bool WindowsIsDark()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object v = k == null ? null : k.GetValue("AppsUseLightTheme");
                    return v is int && (int)v == 0;
                }
            }
            catch (Exception) { return false; }
        }

        public static void Refresh()
        {
            Dark = WindowsIsDark();
            if (Dark)
            {
                Bg = Color.FromArgb(32, 33, 38); Fg = Color.FromArgb(236, 238, 242); Muted = Color.FromArgb(160, 166, 178);
                InputBg = Color.FromArgb(24, 25, 29); Border = Color.FromArgb(88, 92, 104);
                BtnBg = Color.FromArgb(56, 59, 68); BtnFg = Color.FromArgb(236, 238, 242);
                LogBg = Color.FromArgb(18, 19, 22); LogFg = Color.FromArgb(222, 226, 234);
                Link = Color.FromArgb(120, 170, 255);
                Ok = Color.FromArgb(104, 214, 134); Bad = Color.FromArgb(255, 128, 118); Busy = Color.FromArgb(244, 190, 80);
                Disabled = Color.FromArgb(48, 50, 58);
            }
            else
            {
                Bg = Color.FromArgb(246, 247, 249); Fg = Color.FromArgb(28, 34, 46); Muted = Color.FromArgb(96, 104, 120);
                InputBg = Color.White; Border = Color.FromArgb(196, 202, 212);
                BtnBg = Color.White; BtnFg = Color.FromArgb(28, 34, 46);
                LogBg = Color.White; LogFg = Color.FromArgb(28, 34, 46);
                Link = Color.FromArgb(30, 90, 200);
                Ok = Color.FromArgb(18, 116, 48); Bad = Color.FromArgb(176, 30, 30); Busy = Color.FromArgb(150, 92, 0);
                Disabled = Color.FromArgb(228, 230, 236);
            }
        }

        public static void TitleBar(Form f)
        {
            try
            {
                int on = Dark ? 1 : 0;
                if (DwmSetWindowAttribute(f.Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(f.Handle, 19, ref on, 4);
            }
            catch (Exception) { /* ältere Windows-Version: heller Titel */ }
        }

        /// <summary>Wendet die Farben auf alle Steuerelemente an. Tag "primary:#RRGGBB" färbt einen Hauptknopf.</summary>
        public static void Apply(Control c)
        {
            if (c is Form || c is Panel || c is TableLayoutPanel || c is FlowLayoutPanel) c.BackColor = Bg;
            if (c is LinkLabel)
            {
                var l = (LinkLabel)c; l.LinkColor = Link; l.ActiveLinkColor = Fg; l.VisitedLinkColor = Link; l.ForeColor = Fg; l.BackColor = Color.Transparent;
            }
            else if (c is Label)
            {
                if (c.Tag as string != "status") c.ForeColor = c.Tag as string == "muted" ? Muted : Fg;
                c.BackColor = Color.Transparent;
            }
            else if (c is TextBox)
            {
                var t = (TextBox)c;
                bool log = t.Tag as string == "log";
                t.BorderStyle = BorderStyle.FixedSingle;
                t.BackColor = log ? LogBg : InputBg; t.ForeColor = log ? LogFg : Fg;
            }
            else if (c is Button) StyleButton((Button)c);
            foreach (Control child in c.Controls) Apply(child);
        }

        public static void StyleButton(Button b)
        {
            string tag = b.Tag as string;
            Color back = BtnBg, fore = BtnFg, border = Border;
            if (tag != null && tag.StartsWith("primary:"))
            {
                back = ColorTranslator.FromHtml(tag.Substring(8)); fore = Color.White; border = back;
            }
            if (!b.Enabled) { back = Disabled; fore = Muted; border = Disabled; }
            b.FlatStyle = FlatStyle.Flat; b.UseVisualStyleBackColor = false;
            b.BackColor = back; b.ForeColor = fore;
            b.FlatAppearance.BorderColor = border;
            b.FlatAppearance.MouseOverBackColor = ControlPaint.Light(back, 0.15f);
            b.FlatAppearance.MouseDownBackColor = ControlPaint.Dark(back, 0.1f);
        }
    }

    internal sealed class MainForm : Form
    {
        private const string DefaultServer = "ubuntu@200.234.64.75";
        private static readonly Regex NameRx = new Regex("^[a-z][a-z0-9_-]{1,19}$");

        private readonly TextBox _server = new TextBox();
        private readonly TextBox _name = new TextBox();
        private readonly TextBox _password = new TextBox();
        private readonly TextBox _key = new TextBox();
        private readonly Button _btnSetup = new Button();
        private readonly Button _btnTest = new Button();
        private readonly Button _btnStatus = new Button();
        private readonly Button _btnInt = new Button();
        private readonly Button _btnProd = new Button();
        private readonly Label _status = new Label();
        private readonly TextBox _log = new TextBox();
        private readonly TableLayoutPanel _root = new TableLayoutPanel();
        private readonly string _dir;
        private readonly string _configFile;
        private Process _proc;
        private string _okText;
        private string _statusKind = "muted";
        private readonly StringBuilder _all = new StringBuilder();

        public MainForm()
        {
            _dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PontivoDeploy");
            _configFile = Path.Combine(_dir, "config.txt");

            Text = "Pontivo Deploy";
            Font = new Font("Segoe UI", 10f);
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(800, 700);
            MinimumSize = new Size(720, 640);
            StartPosition = FormStartPosition.CenterScreen;

            _root.Dock = DockStyle.Fill; _root.ColumnCount = 1; _root.Padding = new Padding(18, 14, 18, 14);
            _root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            // Zeilen: Titel, Einstellungen, kleine Knöpfe, Hauptknöpfe, Links, Status, Protokoll (füllt den Rest)
            for (int i = 0; i < 6; i++) _root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            _root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(_root);

            var title = new Label { Text = "Pontivo ausrollen", Font = new Font("Segoe UI Semibold", 16f), AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
            _root.Controls.Add(title, 0, 0);

            // Einstellungen
            var form = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Top, Margin = new Padding(0, 0, 0, 6) };
            form.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            form.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            AddRow(form, 0, "Server (Benutzer@Adresse)", _server);
            AddRow(form, 1, "Dein Deploy-Name", _name);
            AddRow(form, 2, "Deploy-Passwort", _password);
            AddRow(form, 3, "Schlüsseldatei", _key);
            _password.UseSystemPasswordChar = true;
            _root.Controls.Add(form, 0, 1);

            var hint = new Label { Text = "Das Passwort wird nie gespeichert. Name, Server und Schlüssel merkt sich das Programm.", Tag = "muted", AutoSize = true, Margin = new Padding(0, 0, 0, 8) };
            _root.Controls.Add(hint, 0, 2);

            // Kleine Knöpfe
            var small = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Top, WrapContents = true, Margin = new Padding(0, 0, 0, 10) };
            foreach (var b in new[] { _btnSetup, _btnTest, _btnStatus }) { b.AutoSize = true; b.AutoSizeMode = AutoSizeMode.GrowAndShrink; b.Padding = new Padding(10, 4, 10, 4); b.Margin = new Padding(0, 0, 10, 0); small.Controls.Add(b); }
            _btnSetup.Text = "Zugang einrichten …"; _btnTest.Text = "Verbindung testen"; _btnStatus.Text = "Stand anzeigen";
            _root.Controls.Add(small, 0, 3);

            // Hauptknöpfe
            var big = new TableLayoutPanel { ColumnCount = 2, RowCount = 1, Dock = DockStyle.Top, Height = 64, Margin = new Padding(0, 0, 0, 6) };
            big.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); big.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            big.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            _btnInt.Text = "1.  Auf INT ausrollen  (Test)"; _btnInt.Tag = "primary:#2463EB";
            _btnProd.Text = "2.  INT auf PROD ausrollen  (echt)"; _btnProd.Tag = "primary:#C44C14";
            foreach (var b in new[] { _btnInt, _btnProd }) { b.Dock = DockStyle.Fill; b.Font = new Font("Segoe UI Semibold", 11f); b.Margin = new Padding(0, 0, 6, 0); }
            _btnProd.Margin = new Padding(6, 0, 0, 0);
            big.Controls.Add(_btnInt, 0, 0); big.Controls.Add(_btnProd, 1, 0);
            _root.Controls.Add(big, 0, 4);

            var links = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, Margin = new Padding(0, 0, 0, 4) };
            var lnkInt = new LinkLabel { Text = "int.pontivo.ch öffnen", AutoSize = true, Margin = new Padding(0, 0, 20, 0) };
            lnkInt.LinkClicked += delegate { OpenUrl("https://int.pontivo.ch"); };
            var lnkProd = new LinkLabel { Text = "pontivo.ch öffnen", AutoSize = true };
            lnkProd.LinkClicked += delegate { OpenUrl("https://pontivo.ch"); };
            links.Controls.Add(lnkInt); links.Controls.Add(lnkProd);
            _root.Controls.Add(links, 0, 5);

            // Status und Protokoll
            var bottom = new TableLayoutPanel { ColumnCount = 1, RowCount = 2, Dock = DockStyle.Fill, Margin = new Padding(0) };
            bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize)); bottom.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            _status.AutoSize = true; _status.Tag = "status"; _status.Font = new Font("Segoe UI Semibold", 10.5f); _status.Margin = new Padding(0, 4, 0, 6);
            _log.Multiline = true; _log.ReadOnly = true; _log.ScrollBars = ScrollBars.Vertical; _log.WordWrap = true; _log.Tag = "log";
            _log.Font = new Font("Consolas", 10f); _log.Dock = DockStyle.Fill; _log.Margin = new Padding(0);
            bottom.Controls.Add(_status, 0, 0); bottom.Controls.Add(_log, 0, 1);
            _root.Controls.Add(bottom, 0, 6);
            _root.SizeChanged += delegate { _status.MaximumSize = new Size(Math.Max(200, _root.ClientSize.Width - 40), 0); };

            LoadConfig();
            _btnSetup.Click += delegate { OpenSetup(); };
            _btnTest.Click += delegate { RunAction("Verbindung testen", "test", "Verbindung in Ordnung."); };
            _btnStatus.Click += delegate { RunAction("Stand anzeigen", "status", "Stand abgefragt."); };
            _btnInt.Click += delegate { RunAction("Auf int ausrollen", "int", "int ist aktuell. Jetzt auf int.pontivo.ch testen, dann auf prod ausrollen."); };
            _btnProd.Click += delegate { RunProd(); };
            foreach (var b in new[] { _btnSetup, _btnTest, _btnStatus, _btnInt, _btnProd }) { b.EnabledChanged += delegate { Theme.StyleButton(b); }; b.Cursor = Cursors.Hand; }
            _password.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; RunAction("Verbindung testen", "test", "Verbindung in Ordnung."); } };

            ApplyTheme();
            Microsoft.Win32.SystemEvents.UserPreferenceChanged += OnPrefChanged;
            FormClosing += OnClosing;
            FormClosed += delegate { Microsoft.Win32.SystemEvents.UserPreferenceChanged -= OnPrefChanged; };
            Log("Erstes Mal? «Zugang einrichten …» erzeugt deinen Schlüssel. Danach «Verbindung testen».");
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Theme.TitleBar(this);
        }

        private static void AddRow(TableLayoutPanel t, int row, string label, TextBox box)
        {
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 16, 6) }, 0, row);
            box.Anchor = AnchorStyles.Left | AnchorStyles.Right; box.Margin = new Padding(0, 4, 0, 4);
            t.Controls.Add(box, 1, row);
        }

        private static void OpenUrl(string url)
        {
            try { Process.Start(url); } catch (Exception) { /* kein Browser */ }
        }

        private void OnPrefChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            if (e.Category != UserPreferenceCategory.General && e.Category != UserPreferenceCategory.Color && e.Category != UserPreferenceCategory.VisualStyle) return;
            try { BeginInvoke(new Action(ApplyTheme)); } catch (Exception) { /* Fenster zu */ }
        }

        private void ApplyTheme()
        {
            Theme.Refresh();
            Theme.Apply(this);
            if (IsHandleCreated) Theme.TitleBar(this);
            SetStatus(_status.Text, _statusKind);
            Invalidate(true);
        }

        private void SetStatus(string text, string kind)
        {
            _status.Text = text; _statusKind = kind;
            _status.ForeColor = kind == "ok" ? Theme.Ok : kind == "bad" ? Theme.Bad : kind == "busy" ? Theme.Busy : Theme.Muted;
        }

        private void LoadConfig()
        {
            _server.Text = DefaultServer;
            _key.Text = Path.Combine(_dir, "id_ed25519");
            try
            {
                if (File.Exists(_configFile))
                    foreach (string line in File.ReadAllLines(_configFile, Encoding.UTF8))
                    {
                        int i = line.IndexOf('=');
                        if (i < 0) continue;
                        string k = line.Substring(0, i).Trim(), v = line.Substring(i + 1).Trim();
                        if (k == "server" && v.Length > 0) _server.Text = v;
                        if (k == "name") _name.Text = v;
                        if (k == "key" && v.Length > 0) _key.Text = v;
                    }
            }
            catch (Exception) { /* Standardwerte */ }
        }

        private void SaveConfig()
        {
            try
            {
                Directory.CreateDirectory(_dir);
                File.WriteAllLines(_configFile, new[] { "server=" + _server.Text.Trim(), "name=" + _name.Text.Trim(), "key=" + _key.Text.Trim() }, Encoding.UTF8);
            }
            catch (Exception) { /* nicht kritisch */ }
        }

        private void Log(string line)
        {
            string clean = Regex.Replace(line ?? "", "\x1b\\[[0-9;?]*[A-Za-z]", "");
            _all.AppendLine(clean);
            _log.AppendText(clean + Environment.NewLine);
        }

        private void SetBusy(bool busy)
        {
            foreach (var b in new[] { _btnSetup, _btnTest, _btnStatus, _btnInt, _btnProd }) b.Enabled = !busy;
        }

        internal static string SshTool(string exe)
        {
            string p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", exe + ".exe");
            return File.Exists(p) ? p : exe;
        }

        private void OpenSetup()
        {
            using (var dlg = new SetupForm(_dir, _key.Text.Trim(), _name.Text.Trim()))
            {
                dlg.ShowDialog(this);
                if (dlg.KeyPath.Length > 0) _key.Text = dlg.KeyPath;
                if (dlg.DeployName.Length > 0) _name.Text = dlg.DeployName;
                SaveConfig();
            }
        }

        private void RunProd()
        {
            DialogResult r = MessageBox.Show(this,
                "Die Version, die jetzt auf INT läuft, wird freigegeben und auf PROD (pontivo.ch, echte Daten) ausgerollt.\n\nHaben Sie INT getestet?",
                "Auf PROD ausrollen", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.Yes) return;
            RunAction("Auf prod ausrollen", "prod", "prod ist aktualisiert. Bitte pontivo.ch kurz prüfen (Anmelden, eine Seite öffnen).");
        }

        private void RunAction(string title, string action, string okText)
        {
            if (_proc != null) return;
            string server = _server.Text.Trim(), name = _name.Text.Trim(), key = _key.Text.Trim();
            string problem = null;
            if (!Regex.IsMatch(server, "^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$")) problem = "Bitte den Server als Benutzer@Adresse eintragen, z. B. ubuntu@200.234.64.75.";
            else if (!NameRx.IsMatch(name)) problem = "Bitte deinen Deploy-Namen eintragen (2–20 Zeichen, nur kleine Buchstaben, Ziffern, - und _).";
            else if (!File.Exists(key)) problem = "Die Schlüsseldatei fehlt. Bitte zuerst «Zugang einrichten …» ausführen.";
            else if (_password.Text.Length == 0) problem = "Bitte das Deploy-Passwort eingeben.";
            if (problem != null) { SetStatus(problem, "bad"); _password.Focus(); return; }
            SaveConfig();

            string args = "-T -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30"
                + " -i \"" + key + "\" " + server + " " + action;

            _log.Clear(); _all.Clear();
            Log("== " + title + "  (" + DateTime.Now.ToString("HH:mm:ss") + ") ==");
            SetStatus(title + " läuft …", "busy");
            SetBusy(true);
            _okText = okText;

            var psi = new ProcessStartInfo(SshTool("ssh"), args)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            };
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (s, e) => Post(e.Data);
            p.ErrorDataReceived += (s, e) => Post(e.Data);
            p.Exited += (s, e) =>
            {
                int code;
                try { p.WaitForExit(); code = p.ExitCode; } catch (Exception) { code = -1; }
                try { BeginInvoke(new Action(() => Finish(code))); } catch (Exception) { /* Fenster zu */ }
            };
            _proc = p;
            try
            {
                p.Start();
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                // Das Passwort geht als erste Zeile an den Server (nicht in die Befehlszeile, damit es in keiner Prozessliste steht).
                p.StandardInput.Write(_password.Text + "\n");
                p.StandardInput.Close();
            }
            catch (Exception ex)
            {
                Log("Start fehlgeschlagen: " + ex.Message);
                SetStatus("Fehler: ssh nicht gefunden (Windows-Funktion «OpenSSH-Client» installieren).", "bad");
                SetBusy(false); _proc = null;
            }
        }

        private void Post(string line)
        {
            if (line == null) return;
            try { BeginInvoke(new Action(() => Log(line))); } catch (Exception) { /* Fenster zu */ }
        }

        private void Finish(int code)
        {
            _proc = null;
            SetBusy(false);
            string all = _all.ToString();
            if (code == 0)
            {
                Log("== Fertig ==");
                SetStatus("✔ " + _okText, "ok");
                return;
            }
            Log("== Fehlgeschlagen (Code " + code + ") ==");
            string hint = "Fehlgeschlagen. Meldung im Fenster lesen.";
            if (all.Contains("Passwort falsch")) { hint = "Passwort falsch. (Nach drei Sekunden Wartezeit pro Versuch ist ein neuer Versuch möglich.)"; _password.SelectAll(); _password.Focus(); }
            else if (Regex.IsMatch(all, @"Permission denied \(publickey")) hint = "Anmeldung abgelehnt: Dein Schlüssel ist auf dem Server noch nicht eingerichtet. «Zugang einrichten …» öffnen und den Befehl an Martin senden.";
            else if (all.Contains("anderer Ausroll-Vorgang")) hint = "Es läuft gerade ein anderer Ausroll-Vorgang. Bitte kurz warten und noch einmal versuchen.";
            else if (all.Contains("Zugang nicht eingerichtet")) hint = "Der Zugang ist auf dem Server unvollständig eingerichtet. Bitte Martin melden.";
            else if (Regex.IsMatch(all, "a password is required|no tty present|sudo: ")) hint = "sudo verlangt ein Passwort: auf dem Server muss sudo für den Benutzer ohne Passwort erlaubt sein.";
            else if (Regex.IsMatch(all, "client_loop|Connection reset|Broken pipe|Connection closed by|send disconnect")) hint = "Die Verbindung ist abgerissen. Der Vorgang läuft auf dem Server trotzdem weiter. In ein bis zwei Minuten «Stand anzeigen» drücken: unten steht, ob er fertig ist.";
            else if (Regex.IsMatch(all, "Could not resolve|timed out|Connection refused|No route")) hint = "Server nicht erreichbar (Adresse, Internet, Firewall prüfen).";
            else if (all.Contains("STOPP")) hint = "Gestoppt: die Meldung «STOPP» im Fenster sagt, was zu ändern ist.";
            SetStatus("✘ " + hint, "bad");
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (_proc == null) return;
            DialogResult r = MessageBox.Show(this,
                "Ein Befehl läuft noch auf dem Server. Beim Schliessen wird nur die Verbindung getrennt, auf dem Server kann der Vorgang trotzdem weiterlaufen oder unvollständig bleiben.\n\nTrotzdem schliessen?",
                "Pontivo Deploy", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.Yes) { e.Cancel = true; return; }
            try { _proc.Kill(); } catch (Exception) { /* schon beendet */ }
        }
    }

    /// <summary>Schlüssel erzeugen und den Befehl für den Server anzeigen (Zugang einrichten).</summary>
    internal sealed class SetupForm : Form
    {
        private static readonly Regex NameRx = new Regex("^[a-z][a-z0-9_-]{1,19}$");
        private readonly string _dir;
        private readonly TextBox _name = new TextBox();
        private readonly TextBox _out = new TextBox();
        private readonly Button _btnGen = new Button();
        private readonly Button _btnCopy = new Button();
        private readonly Button _btnClose = new Button();
        private readonly Label _msg = new Label();
        private string _keyPath;

        public string KeyPath { get { return _keyPath ?? ""; } }
        public string DeployName { get { return NameRx.IsMatch(_name.Text.Trim()) ? _name.Text.Trim() : ""; } }

        public SetupForm(string dir, string keyPath, string name)
        {
            _dir = dir;
            _keyPath = string.IsNullOrEmpty(keyPath) ? Path.Combine(dir, "id_ed25519") : keyPath;
            Text = "Zugang einrichten";
            Font = new Font("Segoe UI", 10f);
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(760, 560);
            MinimumSize = new Size(640, 480);
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(18, 14, 18, 14) };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int i = 0; i < 5; i++) root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(root);

            root.Controls.Add(new Label { Text = "Zugang einrichten", Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Margin = new Padding(0, 0, 0, 8) }, 0, 0);
            var intro = new Label
            {
                Text = "1.  Deploy-Namen wählen (z. B. anna).\r\n2.  «Schlüssel erzeugen» drücken. Der Schlüssel bleibt auf diesem Computer.\r\n3.  Den Befehl unten kopieren und an Martin schicken. Martin führt ihn auf dem Server aus und legt dabei dein Passwort fest.\r\n4.  Danach im Hauptfenster Namen und Passwort eintragen und «Verbindung testen».",
                AutoSize = true, MaximumSize = new Size(720, 0), Margin = new Padding(0, 0, 0, 10),
            };
            root.Controls.Add(intro, 0, 1);

            var row = new TableLayoutPanel { ColumnCount = 3, AutoSize = true, Dock = DockStyle.Top, Margin = new Padding(0, 0, 0, 8) };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            row.Controls.Add(new Label { Text = "Deploy-Name", AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 16, 6) }, 0, 0);
            _name.Anchor = AnchorStyles.Left | AnchorStyles.Right; _name.Text = name; _name.Margin = new Padding(0, 4, 12, 4);
            row.Controls.Add(_name, 1, 0);
            _btnGen.Text = "Schlüssel erzeugen"; _btnGen.AutoSize = true; _btnGen.Padding = new Padding(10, 4, 10, 4); _btnGen.Margin = new Padding(0);
            row.Controls.Add(_btnGen, 2, 0);
            root.Controls.Add(row, 0, 2);

            root.Controls.Add(new Label { Text = "Befehl für den Server (Martin führt ihn als root aus):", AutoSize = true, Margin = new Padding(0, 4, 0, 4) }, 0, 3);
            _msg.AutoSize = true; _msg.Tag = "status"; _msg.MaximumSize = new Size(720, 0); _msg.Font = new Font("Segoe UI Semibold", 10f); _msg.Margin = new Padding(0, 0, 0, 4);
            root.Controls.Add(_msg, 0, 4);

            _out.Multiline = true; _out.ReadOnly = true; _out.WordWrap = true; _out.ScrollBars = ScrollBars.Vertical; _out.Tag = "log";
            _out.Font = new Font("Consolas", 10f); _out.Dock = DockStyle.Fill; _out.Margin = new Padding(0, 0, 0, 10);
            root.Controls.Add(_out, 0, 5);

            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, FlowDirection = FlowDirection.RightToLeft };
            _btnClose.Text = "Schliessen"; _btnCopy.Text = "Befehl kopieren";
            foreach (var b in new[] { _btnClose, _btnCopy }) { b.AutoSize = true; b.Padding = new Padding(10, 4, 10, 4); b.Margin = new Padding(10, 0, 0, 0); b.Cursor = Cursors.Hand; buttons.Controls.Add(b); }
            root.Controls.Add(buttons, 0, 6);

            _btnGen.Cursor = Cursors.Hand;
            _btnGen.Click += delegate { Generate(); };
            _btnCopy.Click += delegate { CopyCommand(); };
            _btnClose.Click += delegate { Close(); };
            _name.TextChanged += delegate { ShowCommand(); };

            Theme.Refresh(); Theme.Apply(this);
            if (File.Exists(_keyPath + ".pub")) ShowCommand();
            else SetMsg("Noch kein Schlüssel vorhanden.", "muted");
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Theme.TitleBar(this);
        }

        private void SetMsg(string text, string kind)
        {
            _msg.Text = text;
            _msg.ForeColor = kind == "ok" ? Theme.Ok : kind == "bad" ? Theme.Bad : Theme.Muted;
        }

        private void Generate()
        {
            if (!NameRx.IsMatch(_name.Text.Trim())) { SetMsg("Bitte zuerst einen Deploy-Namen eintragen (2–20 Zeichen: kleine Buchstaben, Ziffern, - und _).", "bad"); _name.Focus(); return; }
            if (File.Exists(_keyPath + ".pub") && File.Exists(_keyPath)) { ShowCommand(); SetMsg("Es gibt schon einen Schlüssel auf diesem Computer. Er wird weiterverwendet.", "ok"); return; }
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_keyPath));
                var psi = new ProcessStartInfo(MainFormSsh("ssh-keygen"), "-q -t ed25519 -N \"\" -C \"pontivo-deploy-" + _name.Text.Trim() + "\" -f \"" + _keyPath + "\"")
                {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true,
                };
                using (var p = Process.Start(psi))
                {
                    string err = p.StandardError.ReadToEnd() + p.StandardOutput.ReadToEnd();
                    p.WaitForExit();
                    if (p.ExitCode != 0) { SetMsg("Schlüssel konnte nicht erzeugt werden: " + err.Trim(), "bad"); return; }
                }
            }
            catch (Exception ex)
            {
                SetMsg("ssh-keygen nicht gefunden (Windows-Funktion «OpenSSH-Client» installieren): " + ex.Message, "bad");
                return;
            }
            ShowCommand();
            SetMsg("Schlüssel erzeugt. Jetzt den Befehl kopieren und an Martin schicken.", "ok");
        }

        private static string MainFormSsh(string exe) { return MainForm.SshTool(exe); }

        private void ShowCommand()
        {
            string pub = null;
            try { if (File.Exists(_keyPath + ".pub")) pub = File.ReadAllText(_keyPath + ".pub", Encoding.UTF8).Trim(); } catch (Exception) { }
            if (pub == null) { _out.Text = ""; return; }
            string name = NameRx.IsMatch(_name.Text.Trim()) ? _name.Text.Trim() : "DEIN-NAME";
            // Nur Schlüsselart und Schlüssel (ohne Kommentar) in den Befehl; der Server vergibt die Einschränkung selbst.
            string[] parts = pub.Split(' ');
            string keyOnly = parts.Length >= 2 ? parts[0] + " " + parts[1] : pub;
            _out.Text = "cd /opt/pontivo-int/deploy && ./deploy-user.sh add " + name + " \"" + keyOnly + "\"";
        }

        private void CopyCommand()
        {
            if (_out.Text.Length == 0) { SetMsg("Zuerst «Schlüssel erzeugen».", "bad"); return; }
            if (!NameRx.IsMatch(_name.Text.Trim())) { SetMsg("Bitte zuerst einen Deploy-Namen eintragen.", "bad"); return; }
            try { Clipboard.SetText(_out.Text); SetMsg("Befehl kopiert. Jetzt per Nachricht an Martin schicken.", "ok"); }
            catch (Exception) { SetMsg("Kopieren hat nicht geklappt. Den Text bitte von Hand markieren und kopieren.", "bad"); }
        }
    }
}
