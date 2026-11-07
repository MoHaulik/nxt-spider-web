#!/bin/sh
# Build and publish to GitHub Pages (gh-pages branch).
set -e
cd "$(dirname "$0")"
NODE_ENV=production npx vite build
touch dist/.nojekyll # IWSDK emits files that start with "_", which Jekyll would drop
rm -rf .deploy && git worktree prune
git fetch origin gh-pages 2>/dev/null || true
if git show-ref --quiet refs/remotes/origin/gh-pages; then git worktree add -f .deploy origin/gh-pages; else git worktree add -f --detach .deploy && (cd .deploy && git checkout --orphan gh-pages && git rm -rfq . || true); fi
cd .deploy
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R ../dist/. .
git add -A
git commit -qm "Deploy $(cd .. && git rev-parse --short HEAD)" || echo "nothing to deploy"
git push -q origin HEAD:gh-pages
cd .. && git worktree remove --force .deploy
