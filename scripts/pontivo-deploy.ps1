<#
  Pontivo-Deploy: kleine Oberfläche zum Ausrollen auf int (Test) und von int auf prod (echt).
  Start: Doppelklick auf scripts\pontivo-deploy.bat   (oder: powershell -ExecutionPolicy Bypass -File scripts\pontivo-deploy.ps1)
  Voraussetzung: OpenSSH-Client (in Windows 10/11 enthalten) und SSH-Zugang per Schlüssel wie bei scripts\pull-backups.ps1.
  Das Programm führt auf dem Server nur diese Befehle aus: ship.sh int, ship.sh prod und eine reine Status-Abfrage.
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

if (-not ('SshRunner' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;

public class SshRunner {
    public ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public Process Proc;
    public int ExitCode = -1;
    public volatile bool Done;

    public void Start(string exe, string args, string stdin) {
        ProcessStartInfo psi = new ProcessStartInfo(exe, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        Proc = new Process();
        Proc.StartInfo = psi;
        Proc.EnableRaisingEvents = true;
        Proc.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Lines.Enqueue(e.Data); };
        Proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Lines.Enqueue(e.Data); };
        Proc.Exited += delegate(object s, EventArgs e) {
            try { Proc.WaitForExit(); ExitCode = Proc.ExitCode; } catch (Exception) { }
            Done = true;
        };
        Proc.Start();
        Proc.BeginOutputReadLine();
        Proc.BeginErrorReadLine();
        if (!string.IsNullOrEmpty(stdin)) { Proc.StandardInput.Write(stdin.Replace("\r\n", "\n")); }
        Proc.StandardInput.Close();
    }

    public void Stop() {
        try { if (Proc != null && !Proc.HasExited) Proc.Kill(); } catch (Exception) { }
    }
}
"@
}

$ConfigDir = Join-Path $env:APPDATA "PontivoDeploy"
$ConfigFile = Join-Path $ConfigDir "config.json"
$Config = @{ Server = "ubuntu@200.234.64.75"; Key = "" }
if (Test-Path $ConfigFile) {
    try { $j = Get-Content $ConfigFile -Raw | ConvertFrom-Json; if ($j.Server) { $Config.Server = $j.Server }; if ($j.Key) { $Config.Key = $j.Key } } catch { }
}
function Save-Config {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    ($Config | ConvertTo-Json) | Set-Content -Path $ConfigFile -Encoding UTF8
}

$Ssh = Join-Path $env:SystemRoot "System32\OpenSSH\ssh.exe"
if (-not (Test-Path $Ssh)) { $Ssh = "ssh" }

# ---------------------------------------------------------------- Oberfläche
$font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$mono = New-Object System.Drawing.Font("Consolas", 9.5)
$form = New-Object System.Windows.Forms.Form
$form.Text = "Pontivo Deploy"
$form.Size = New-Object System.Drawing.Size(760, 640)
$form.MinimumSize = New-Object System.Drawing.Size(640, 520)
$form.StartPosition = "CenterScreen"
$form.Font = $font

function New-Label($text, $x, $y, $w) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text; $l.Location = New-Object System.Drawing.Point($x, $y); $l.Size = New-Object System.Drawing.Size($w, 22)
    $l.TextAlign = "MiddleLeft"
    return $l
}
function New-Button($text, $x, $y, $w, $h) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text; $b.Location = New-Object System.Drawing.Point($x, $y); $b.Size = New-Object System.Drawing.Size($w, $h)
    $b.FlatStyle = "System"
    return $b
}

$form.Controls.Add((New-Label "Server (Benutzer@Adresse)" 14 14 170))
$txtServer = New-Object System.Windows.Forms.TextBox
$txtServer.Location = New-Object System.Drawing.Point(190, 14); $txtServer.Size = New-Object System.Drawing.Size(330, 24)
$txtServer.Text = $Config.Server; $txtServer.Anchor = "Top,Left,Right"
$form.Controls.Add($txtServer)

$form.Controls.Add((New-Label "SSH-Schlüssel (leer = Standard)" 14 44 170))
$txtKey = New-Object System.Windows.Forms.TextBox
$txtKey.Location = New-Object System.Drawing.Point(190, 44); $txtKey.Size = New-Object System.Drawing.Size(330, 24)
$txtKey.Text = $Config.Key; $txtKey.Anchor = "Top,Left,Right"
$form.Controls.Add($txtKey)

$btnTest = New-Button "Verbindung testen" 540 12 190 28
$btnTest.Anchor = "Top,Right"
$form.Controls.Add($btnTest)
$btnStatus = New-Button "Stand anzeigen" 540 42 190 28
$btnStatus.Anchor = "Top,Right"
$form.Controls.Add($btnStatus)

$btnInt = New-Button "1.  Auf INT ausrollen (Test)" 14 84 350 52
$btnInt.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnInt)
$btnProd = New-Button "2.  INT auf PROD ausrollen (echt)" 380 84 350 52
$btnProd.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$btnProd.Anchor = "Top,Right"
$form.Controls.Add($btnProd)

$lnkInt = New-Object System.Windows.Forms.LinkLabel
$lnkInt.Text = "int.pontivo.ch öffnen"; $lnkInt.Location = New-Object System.Drawing.Point(14, 144); $lnkInt.Size = New-Object System.Drawing.Size(180, 22)
$form.Controls.Add($lnkInt)
$lnkProd = New-Object System.Windows.Forms.LinkLabel
$lnkProd.Text = "pontivo.ch öffnen"; $lnkProd.Location = New-Object System.Drawing.Point(200, 144); $lnkProd.Size = New-Object System.Drawing.Size(180, 22)
$form.Controls.Add($lnkProd)

$lblStatus = New-Label "Bereit." 14 170 716
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblStatus.Anchor = "Top,Left,Right"
$form.Controls.Add($lblStatus)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = "Vertical"; $log.WordWrap = $true
$log.Font = $mono; $log.BackColor = [System.Drawing.Color]::FromArgb(24, 28, 36); $log.ForeColor = [System.Drawing.Color]::FromArgb(220, 224, 232)
$log.Location = New-Object System.Drawing.Point(14, 198); $log.Size = New-Object System.Drawing.Size(716, 390)
$log.Anchor = "Top,Bottom,Left,Right"
$form.Controls.Add($log)

# ---------------------------------------------------------------- Ablauf
$script:Runner = $null
$script:Title = ""
$script:Ok = ""
$buttons = @($btnInt, $btnProd, $btnTest, $btnStatus)

function Add-Log([string]$line) {
    $clean = [regex]::Replace($line, "\x1b\[[0-9;?]*[A-Za-z]", "")
    $log.AppendText($clean + [Environment]::NewLine)
}
function Set-Status([string]$text, $color) {
    $lblStatus.Text = $text; $lblStatus.ForeColor = $color
}
function Set-Busy([bool]$busy) {
    foreach ($b in $buttons) { $b.Enabled = -not $busy }
    $txtServer.Enabled = -not $busy; $txtKey.Enabled = -not $busy
}

function Start-Remote([string]$title, [string]$remoteArgs, [string]$stdin, [string]$okText) {
    $server = $txtServer.Text.Trim()
    if ($server -notmatch "^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$") {
        [System.Windows.Forms.MessageBox]::Show("Bitte den Server als Benutzer@Adresse eintragen, z. B. ubuntu@200.234.64.75.", "Pontivo Deploy") | Out-Null
        return
    }
    $Config.Server = $server; $Config.Key = $txtKey.Text.Trim(); Save-Config
    $sshArgs = "-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30"
    if ($Config.Key) { $sshArgs += " -i `"$($Config.Key)`"" }
    $sshArgs += " $server $remoteArgs"
    $log.Clear()
    Add-Log ("== {0}  ({1}) ==" -f $title, (Get-Date -Format "HH:mm:ss"))
    Set-Status "$title läuft ..." ([System.Drawing.Color]::FromArgb(180, 110, 0))
    Set-Busy $true
    $script:Title = $title; $script:Ok = $okText
    $script:Runner = New-Object SshRunner
    try {
        $script:Runner.Start($Ssh, $sshArgs, $stdin)
    } catch {
        Add-Log ("Start fehlgeschlagen: " + $_.Exception.Message)
        Set-Status "Fehler: ssh nicht gefunden (Windows-Funktion «OpenSSH-Client» installieren)." ([System.Drawing.Color]::Firebrick)
        Set-Busy $false
        $script:Runner = $null
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    if ($null -eq $script:Runner) { return }
    $line = $null
    $n = 0
    while ($script:Runner.Lines.TryDequeue([ref]$line) -and $n -lt 200) { Add-Log $line; $n++ }
    if ($script:Runner.Done -and $script:Runner.Lines.IsEmpty) {
        $code = $script:Runner.ExitCode
        $all = $log.Text
        $script:Runner = $null
        Set-Busy $false
        if ($code -eq 0) {
            Add-Log "== Fertig =="
            Set-Status ("✔ " + $script:Ok) ([System.Drawing.Color]::FromArgb(20, 120, 50))
        } else {
            Add-Log "== Fehlgeschlagen (Code $code) =="
            $hint = "Fehlgeschlagen. Meldung im Fenster lesen."
            if ($all -match "Permission denied \(publickey") { $hint = "Anmeldung abgelehnt: SSH-Schlüssel fehlt oder passt nicht (Feld «SSH-Schlüssel»)." }
            elseif ($all -match "a password is required|no tty present") { $hint = "sudo verlangt ein Passwort: auf dem Server muss sudo für diesen Benutzer ohne Passwort gehen." }
            elseif ($all -match "Could not resolve|timed out|Connection refused|No route") { $hint = "Server nicht erreichbar (Adresse, Internet, Firewall prüfen)." }
            elseif ($all -match "STOPP") { $hint = "Gestoppt: die Meldung «STOPP» im Fenster sagt, was zu ändern ist." }
            Set-Status ("✘ " + $hint) ([System.Drawing.Color]::Firebrick)
        }
    }
})
$timer.Start()

$btnTest.Add_Click({
    $script = @'
echo "Verbunden als $(whoami) auf $(hostname)"
if sudo -n true 2>/dev/null; then echo "sudo ohne Passwort: ok"; else echo "sudo braucht ein Passwort"; exit 1; fi
if [ -x /opt/pontivo-int/deploy/ship.sh ]; then echo "ship.sh vorhanden: ok"; else echo "ship.sh fehlt: einmal auf dem Server im Ordner /opt/pontivo-int/deploy den Befehl ./deploy-int.sh ausfuehren"; exit 1; fi
'@
    Start-Remote "Verbindung testen" "bash -s" $script "Verbindung in Ordnung."
})

$btnStatus.Add_Click({
    $script = @'
echo "int:   $(git -C /opt/pontivo-int log -1 --format='%h  %s  (%cd)' --date=short 2>/dev/null)"
echo "prod:  $(git -C /opt/pontivo describe --tags --always 2>/dev/null)  ->  $(git -C /opt/pontivo log -1 --format='%h  %s' 2>/dev/null)"
echo "Gesundheit prod: $(curl -fsS --max-time 15 'https://pontivo.ch/api/health?deep=1' 2>&1 | head -c 200)"
echo "Gesundheit int:  $(curl -fsS --max-time 15 'https://int.pontivo.ch/api/health' 2>&1 | head -c 100)"
'@
    Start-Remote "Stand anzeigen" "bash -s" $script "Stand abgefragt."
})

$btnInt.Add_Click({
    Start-Remote "Auf int ausrollen" "sudo /opt/pontivo-int/deploy/ship.sh int" "" "int ist aktuell. Jetzt auf int.pontivo.ch testen, dann auf prod ausrollen."
})

$btnProd.Add_Click({
    $msg = "Die Version, die jetzt auf INT läuft, wird freigegeben und auf PROD (pontivo.ch, echte Daten) ausgerollt.`n`nHaben Sie INT getestet?"
    $r = [System.Windows.Forms.MessageBox]::Show($msg, "Auf PROD ausrollen", "YesNo", "Warning", "Button2")
    if ($r -ne "Yes") { return }
    Start-Remote "Auf prod ausrollen" "sudo /opt/pontivo-int/deploy/ship.sh prod" "" "prod ist aktualisiert. Bitte pontivo.ch kurz prüfen (Anmelden, eine Seite öffnen)."
})

$lnkInt.Add_LinkClicked({ Start-Process "https://int.pontivo.ch" })
$lnkProd.Add_LinkClicked({ Start-Process "https://pontivo.ch" })

$form.Add_FormClosing({
    param($s, $e)
    if ($null -ne $script:Runner) {
        $r = [System.Windows.Forms.MessageBox]::Show("Ein Befehl läuft noch auf dem Server. Beim Schliessen wird nur die Verbindung getrennt, auf dem Server kann der Vorgang trotzdem weiterlaufen oder unvollständig bleiben.`n`nTrotzdem schliessen?", "Pontivo Deploy", "YesNo", "Warning", "Button2")
        if ($r -ne "Yes") { $e.Cancel = $true } else { $script:Runner.Stop() }
    }
})

Add-Log "Bereit. «Verbindung testen» prüft Zugang und Rechte, «Stand anzeigen» zeigt, was auf int und prod läuft."
[void]$form.ShowDialog()
