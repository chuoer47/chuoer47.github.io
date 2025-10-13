set -e
#pnpm run docs:build

cd ./src/.vuepress/dist

git init
git add -A
git commit -m 'deploy'

git checkout -b main
git push -f --set-upstream git@github.com:weiruyi/weiruyi.github.io.git main

