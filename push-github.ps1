# Einmalig: Repo anlegen, Remote setzen, Branch main, pushen.
# Voraussetzung: Git installiert (https://git-scm.com/download/win), dann in PowerShell:
#   cd "Pfad\zu\rabbit technik reperatur"
#   .\push-github.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git wurde nicht gefunden. Bitte 'Git for Windows' installieren und PowerShell neu starten, oder 'Git Bash' oeffnen und die Befehle manuell ausfuehren."
    exit 1
}

if (-not (Test-Path .git)) {
    git init
    git add -A
    git status
    git commit -m "Initial commit: Rabbit-Technik Werkstatt"
}

# Remote ggf. ersetzen
$remoteUrl = "https://github.com/rabbittechnik/rabbittechnkiprogramm.git"
git remote remove origin 2>$null
git remote add origin $remoteUrl

git branch -M main
git push -u origin main

Write-Host "Fertig: origin -> $remoteUrl, Branch main."
