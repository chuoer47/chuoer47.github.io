set -e
#pnpm run docs:build

cd ./src/.vuepress/dist

git init
git add -A
git commit -m 'deploy'


git push -f --set-upstream https://github.com/chuoer47/chuoer47.github.io.git master:main

