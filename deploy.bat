@echo off
setlocal

call pnpm run docs:build
if errorlevel 1 exit /b %errorlevel%

echo.
echo Built site to src\.vuepress\dist.
echo Push your source branch to GitHub to publish via GitHub Pages.
