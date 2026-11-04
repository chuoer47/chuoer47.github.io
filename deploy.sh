#!/usr/bin/env sh
set -e

npm run docs:build

printf '\nBuilt site to docs/.vitepress/dist.\n'
printf 'Push your source branch to GitHub to publish via GitHub Pages.\n'
