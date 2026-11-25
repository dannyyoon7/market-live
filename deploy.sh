#!/usr/bin/env bash
# market-live → GitHub Pages 원클릭 배포
#   전제: github.com/dannyyoon7 에 빈 Public 저장소 `market-live` 가 있고,
#        Pickle의 GitHub 연결이 그 저장소에 쓰기 권한을 가짐.
#   사용: bash projects/market-live/deploy.sh
set -euo pipefail

OWNER="${GITHUB_OWNER:-dannyyoon7}"
REPO="${GITHUB_REPO:-market-live}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -d .git ]; then
  git init -q
  git config user.email "${OWNER}@users.noreply.github.com"
  git config user.name "$OWNER"
fi

git add -A
git commit -q -m "chore: 시세 대시보드 배포 $(date +%Y-%m-%d\ %H:%M)" || echo "변경 사항 없음"

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi

git branch -M main
git push -u origin main

echo "── GitHub Pages 활성화"
gh api -X POST "repos/${OWNER}/${REPO}/pages" \
  -H "Accept: application/vnd.github+json" \
  -f "source[branch]=main" -f "source[path]=/" 2>/dev/null \
  || gh api -X PUT "repos/${OWNER}/${REPO}/pages" \
       -H "Accept: application/vnd.github+json" \
       -f "source[branch]=main" -f "source[path]=/" 2>/dev/null \
  || echo "(Pages 설정이 이미 되어 있거나 API 권한이 없습니다 — 저장소 Settings → Pages 에서 main / root 로 지정)"

echo "── 배포 상태"
gh api "repos/${OWNER}/${REPO}/pages" --jq '.html_url, .status' 2>/dev/null || true
echo "URL: https://${OWNER}.github.io/${REPO}/"
