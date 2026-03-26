#!/usr/bin/env sh
set -e

pnpm run docs:build

printf '\nBuilt site to src/.vuepress/dist.\n'
printf 'Push your source branch to GitHub to publish via GitHub Pages.\n'
