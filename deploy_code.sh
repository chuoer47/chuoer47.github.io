set -e

# pnpm run docs:build   

# git init
git add -A
git commit -m 'deploy'

# git checkout -b main
# git checkout main
# git push -f --set-upstream git@github.com:weiruyi/my-docs.git main
git push

