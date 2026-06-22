@echo off
setlocal

call npm run docs:build
if errorlevel 1 exit /b %errorlevel%

echo.
echo Built site to docs\.vitepress\dist.
echo Push your source branch to GitHub to publish via GitHub Pages.
