@echo off
rem Startet die Oberflaeche zum Ausrollen (int und prod). Doppelklick genügt.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0pontivo-deploy.ps1"
