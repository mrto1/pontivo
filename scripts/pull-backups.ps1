<#
  Holt die täglichen Sicherungen vom Server auf diesen Windows-PC (kostenlos, ohne Cloud).
  Aufruf:  powershell -ExecutionPolicy Bypass -File scripts\pull-backups.ps1
  Voraussetzung: OpenSSH-Client (in Windows 10/11 enthalten) und der gleiche SSH-Zugang wie beim Deployen (ubuntu@Server).
  Die Dateien enthalten Personendaten: Zielordner auf einer verschlüsselten Platte ablegen (BitLocker) und nicht in eine Cloud synchronisieren lassen.
#>
param(
  [string]$Server = "ubuntu@200.234.64.75",
  [string]$Dest = "$HOME\PontivoBackups",
  [int]$KeepDays = 90
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
# Nur neue Dateien kopieren (scp überschreibt gleiche Namen mit gleichem Inhalt, das ist unkritisch)
scp -q "${Server}:/opt/pontivo/backups/*" "$Dest\"
if ($LASTEXITCODE -ne 0) { Write-Error "Kopieren fehlgeschlagen (Server erreichbar? SSH-Schlüssel?)"; exit 1 }
# Lokal nur die letzten $KeepDays Tage behalten
Get-ChildItem $Dest -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Force
$n = (Get-ChildItem $Dest -File).Count
$newest = (Get-ChildItem $Dest -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name
Write-Host "Fertig: $n Dateien in $Dest, neueste: $newest"
