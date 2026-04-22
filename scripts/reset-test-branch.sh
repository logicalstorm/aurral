#!/usr/bin/env bash

set -euo pipefail

die() {
  echo "Error: $*" >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "Fetching branches, tags, and notes..."
git fetch --all --prune --tags
git fetch origin 'refs/notes/*:refs/notes/*' >/dev/null 2>&1 || true

local_main="$(git rev-parse main)"
remote_main="$(git rev-parse origin/main)"

if [[ "$local_main" != "$remote_main" ]]; then
  die "main does not match origin/main. Sync main before resetting test."
fi

stable_tag="$(
  git tag --merged origin/main --sort=-v:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | head -n1
)"

if [[ -z "$stable_tag" ]]; then
  die "Could not determine the latest stable tag reachable from origin/main."
fi

notes_pattern="^refs/notes/semantic-release-${stable_tag//./\\.}-test\\.[0-9]+$"

mapfile -t local_tags < <(git tag -l "${stable_tag}-test.*")
mapfile -t remote_tags < <(git ls-remote --tags --refs origin "${stable_tag}-test.*" | awk '{sub("refs/tags/", "", $2); print $2}')
mapfile -t local_notes < <(git for-each-ref --format='%(refname)' refs/notes | grep -E "$notes_pattern" || true)
mapfile -t remote_notes < <(git ls-remote origin "refs/notes/semantic-release-${stable_tag}-test.*" | awk '{print $2}')

if ((${#local_tags[@]})); then
  echo "Deleting local prerelease tags for ${stable_tag}: ${local_tags[*]}"
  git tag -d "${local_tags[@]}"
else
  echo "No local prerelease tags found for ${stable_tag}."
fi

if ((${#local_notes[@]})); then
  echo "Deleting local semantic-release notes for ${stable_tag}."
  for ref in "${local_notes[@]}"; do
    git update-ref -d "$ref"
  done
else
  echo "No local semantic-release notes found for ${stable_tag}."
fi

echo "Resetting test to origin/main..."
git checkout -B test origin/main
git push --force-with-lease origin test

if ((${#remote_tags[@]})); then
  echo "Deleting remote prerelease tags for ${stable_tag}: ${remote_tags[*]}"
  for tag in "${remote_tags[@]}"; do
    git push origin ":refs/tags/$tag"
  done
else
  echo "No remote prerelease tags found for ${stable_tag}."
fi

if ((${#remote_notes[@]})); then
  echo "Deleting remote semantic-release notes for ${stable_tag}."
  for ref in "${remote_notes[@]}"; do
    git push origin ":${ref}"
  done
else
  echo "No remote semantic-release notes found for ${stable_tag}."
fi

echo "Test reset complete."
echo "Next qualifying test release: ${stable_tag}-test.1"
