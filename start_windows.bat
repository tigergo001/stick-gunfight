@echo off
chcp 65001 >nul
title 火柴人机枪大战 Stick Gunfight
cd /d %~dp0
python desktop\app.py
pause
