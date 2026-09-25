@echo off
start "" http://localhost:8080
node "%~dp0serve.mjs" 8080
