using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace PontivoDeploy
{
    /// <summary>
    /// Oberfläche zum Ausrollen von Pontivo: auf int (Test) und von int auf prod (echt).
    /// Sie führt auf dem Server nur aus: ship.sh int, ship.sh prod und eine reine Status-Abfrage (per SSH-Schlüssel, ohne Passwort).
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

    internal sealed class MainForm : Form
    {
        private const string DefaultServer = "ubuntu@200.234.64.75";
        private static readonly Color Ink = Color.FromArgb(28, 34, 46);
        private static readonly Color Muted = Color.FromArgb(104, 112, 128);

        private readonly TextBox _server = new TextBox();
        private readonly TextBox _key = new TextBox();
        private readonly Button _btnTest = new Button();
        private readonly Button _btnStatus = new Button();
        private readonly Button _btnInt = new Button();
        private readonly Button _btnProd = new Button();
        private readonly Label _status = new Label();
        private readonly TextBox _log = new TextBox();
        private readonly string _configFile;
        private Process _proc;
        private string _okText;
        private readonly StringBuilder _all = new StringBuilder();

        public MainForm()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PontivoDeploy");
            _configFile = Path.Combine(dir, "config.txt");

            Text = "Pontivo Deploy";
            Font = new Font("Segoe UI", 9.5f);
            ClientSize = new Size(780, 640);
            MinimumSize = new Size(660, 540);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;

            var title = new Label { Text = "Pontivo ausrollen", Font = new Font("Segoe UI Semibold", 15f), ForeColor = Ink, Location = new Point(18, 12), AutoSize = true };
            Controls.Add(title);

            AddLabel("Server (Benutzer@Adresse)", 18, 56);
            _server.SetBounds(200, 52, 350, 26); _server.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_server);
            AddLabel("SSH-Schlüssel (leer = Standard)", 18, 88);
            _key.SetBounds(200, 84, 350, 26); _key.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_key);

            Style(_btnTest, "Verbindung testen", Color.White, Ink, 568, 50, 194, 30, false);
            Style(_btnStatus, "Stand anzeigen", Color.White, Ink, 568, 84, 194, 30, false);
            _btnTest.Anchor = _btnStatus.Anchor = AnchorStyles.Top | AnchorStyles.Right;

            Style(_btnInt, "1.  Auf INT ausrollen  (Test)", Color.FromArgb(36, 99, 235), Color.White, 18, 132, 360, 58, true);
            Style(_btnProd, "2.  INT auf PROD ausrollen  (echt)", Color.FromArgb(196, 76, 20), Color.White, 396, 132, 366, 58, true);
            _btnProd.Anchor = AnchorStyles.Top | AnchorStyles.Right;

            var lnkInt = new LinkLabel { Text = "int.pontivo.ch öffnen", Location = new Point(18, 198), AutoSize = true };
            lnkInt.LinkClicked += delegate { Process.Start("https://int.pontivo.ch"); };
            var lnkProd = new LinkLabel { Text = "pontivo.ch öffnen", Location = new Point(190, 198), AutoSize = true };
            lnkProd.LinkClicked += delegate { Process.Start("https://pontivo.ch"); };
            Controls.Add(lnkInt); Controls.Add(lnkProd);

            _status.SetBounds(18, 226, 744, 26);
            _status.Font = new Font("Segoe UI Semibold", 10.5f);
            _status.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_status);
            SetStatus("Bereit.", Muted);

            _log.Multiline = true; _log.ReadOnly = true; _log.ScrollBars = ScrollBars.Vertical; _log.WordWrap = true;
            _log.Font = new Font("Consolas", 9.5f);
            _log.BackColor = Color.FromArgb(24, 28, 36); _log.ForeColor = Color.FromArgb(220, 224, 232);
            _log.SetBounds(18, 258, 744, 364);
            _log.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(_log);

            foreach (var b in new[] { _btnTest, _btnStatus, _btnInt, _btnProd }) Controls.Add(b);
            LoadConfig();
            _btnTest.Click += delegate { RunTest(); };
            _btnStatus.Click += delegate { RunStatus(); };
            _btnInt.Click += delegate { Start("Auf int ausrollen", "sudo /opt/pontivo-int/deploy/ship.sh int", null, "int ist aktuell. Jetzt auf int.pontivo.ch testen, dann auf prod ausrollen."); };
            _btnProd.Click += delegate { RunProd(); };
            FormClosing += OnClosing;
            Log("Bereit. «Verbindung testen» prüft Zugang und Rechte, «Stand anzeigen» zeigt, was auf int und prod läuft.");
        }

        private void AddLabel(string text, int x, int y)
        {
            Controls.Add(new Label { Text = text, Location = new Point(x, y), AutoSize = true, ForeColor = Ink });
        }

        private static void Style(Button b, string text, Color back, Color fore, int x, int y, int w, int h, bool bold)
        {
            b.Text = text; b.SetBounds(x, y, w, h);
            b.FlatStyle = FlatStyle.Flat; b.BackColor = back; b.ForeColor = fore; b.UseVisualStyleBackColor = false;
            b.FlatAppearance.BorderColor = back == Color.White ? Color.FromArgb(200, 205, 214) : back;
            b.Cursor = Cursors.Hand;
            if (bold) b.Font = new Font("Segoe UI Semibold", 11f);
        }

        private void LoadConfig()
        {
            _server.Text = DefaultServer;
            try
            {
                if (File.Exists(_configFile))
                    foreach (string line in File.ReadAllLines(_configFile, Encoding.UTF8))
                    {
                        int i = line.IndexOf('=');
                        if (i < 0) continue;
                        string k = line.Substring(0, i).Trim(), v = line.Substring(i + 1).Trim();
                        if (k == "server" && v.Length > 0) _server.Text = v;
                        if (k == "key") _key.Text = v;
                    }
            }
            catch (Exception) { /* Standardwerte */ }
        }

        private void SaveConfig()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_configFile));
                File.WriteAllLines(_configFile, new[] { "server=" + _server.Text.Trim(), "key=" + _key.Text.Trim() }, Encoding.UTF8);
            }
            catch (Exception) { /* nicht kritisch */ }
        }

        private void SetStatus(string text, Color c) { _status.Text = text; _status.ForeColor = c; }

        private void Log(string line)
        {
            string clean = Regex.Replace(line ?? "", "\x1b\\[[0-9;?]*[A-Za-z]", "");
            _all.AppendLine(clean);
            _log.AppendText(clean + Environment.NewLine);
        }

        private void SetBusy(bool busy)
        {
            foreach (var b in new[] { _btnTest, _btnStatus, _btnInt, _btnProd }) b.Enabled = !busy;
            _server.Enabled = !busy; _key.Enabled = !busy;
        }

        private static string SshPath()
        {
            string p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", "ssh.exe");
            return File.Exists(p) ? p : "ssh";
        }

        private void RunTest()
        {
            Start("Verbindung testen", "bash -s",
                "echo \"Verbunden als $(whoami) auf $(hostname)\"\n" +
                "if sudo -n true 2>/dev/null; then echo \"sudo ohne Passwort: ok\"; else echo \"sudo braucht ein Passwort\"; exit 1; fi\n" +
                "if [ -x /opt/pontivo-int/deploy/ship.sh ]; then echo \"ship.sh vorhanden: ok\"; else echo \"ship.sh fehlt: einmal auf dem Server im Ordner /opt/pontivo-int/deploy den Befehl ./deploy-int.sh ausfuehren\"; exit 1; fi\n",
                "Verbindung in Ordnung.");
        }

        private void RunStatus()
        {
            Start("Stand anzeigen", "bash -s",
                "echo \"int:   $(git -C /opt/pontivo-int log -1 --format='%h  %s  (%cd)' --date=short 2>/dev/null)\"\n" +
                "echo \"prod:  $(git -C /opt/pontivo describe --tags --always 2>/dev/null)  ->  $(git -C /opt/pontivo log -1 --format='%h  %s' 2>/dev/null)\"\n" +
                "echo \"Gesundheit prod: $(curl -fsS --max-time 15 'https://pontivo.ch/api/health?deep=1' 2>&1 | head -c 200)\"\n" +
                "echo \"Gesundheit int:  $(curl -fsS --max-time 15 'https://int.pontivo.ch/api/health' 2>&1 | head -c 100)\"\n",
                "Stand abgefragt.");
        }

        private void RunProd()
        {
            DialogResult r = MessageBox.Show(this,
                "Die Version, die jetzt auf INT läuft, wird freigegeben und auf PROD (pontivo.ch, echte Daten) ausgerollt.\n\nHaben Sie INT getestet?",
                "Auf PROD ausrollen", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.Yes) return;
            Start("Auf prod ausrollen", "sudo /opt/pontivo-int/deploy/ship.sh prod", null, "prod ist aktualisiert. Bitte pontivo.ch kurz prüfen (Anmelden, eine Seite öffnen).");
        }

        private void Start(string title, string remote, string stdin, string okText)
        {
            string server = _server.Text.Trim();
            if (!Regex.IsMatch(server, "^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$"))
            {
                MessageBox.Show(this, "Bitte den Server als Benutzer@Adresse eintragen, z. B. ubuntu@200.234.64.75.", "Pontivo Deploy");
                return;
            }
            SaveConfig();
            string args = "-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30";
            if (_key.Text.Trim().Length > 0) args += " -i \"" + _key.Text.Trim() + "\"";
            args += " " + server + " " + remote;

            _log.Clear(); _all.Clear();
            Log("== " + title + "  (" + DateTime.Now.ToString("HH:mm:ss") + ") ==");
            SetStatus(title + " läuft ...", Color.FromArgb(180, 110, 0));
            SetBusy(true);
            _okText = okText;

            var psi = new ProcessStartInfo(SshPath(), args)
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
                if (!string.IsNullOrEmpty(stdin)) p.StandardInput.Write(stdin.Replace("\r\n", "\n"));
                p.StandardInput.Close();
            }
            catch (Exception ex)
            {
                Log("Start fehlgeschlagen: " + ex.Message);
                SetStatus("Fehler: ssh nicht gefunden (Windows-Funktion «OpenSSH-Client» installieren).", Color.Firebrick);
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
                SetStatus("✔ " + _okText, Color.FromArgb(20, 120, 50));
                return;
            }
            Log("== Fehlgeschlagen (Code " + code + ") ==");
            string hint = "Fehlgeschlagen. Meldung im Fenster lesen.";
            if (Regex.IsMatch(all, @"Permission denied \(publickey")) hint = "Anmeldung abgelehnt: SSH-Schlüssel fehlt oder passt nicht (Feld «SSH-Schlüssel»).";
            else if (Regex.IsMatch(all, "a password is required|no tty present")) hint = "sudo verlangt ein Passwort: auf dem Server muss sudo für diesen Benutzer ohne Passwort gehen.";
            else if (Regex.IsMatch(all, "Could not resolve|timed out|Connection refused|No route")) hint = "Server nicht erreichbar (Adresse, Internet, Firewall prüfen).";
            else if (all.Contains("STOPP")) hint = "Gestoppt: die Meldung «STOPP» im Fenster sagt, was zu ändern ist.";
            SetStatus("✘ " + hint, Color.Firebrick);
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
}
