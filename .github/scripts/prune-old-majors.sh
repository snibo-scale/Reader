#!/usr/bin/env bash
# Free release storage: once the current major is published, delete the release
# binaries for every OLDER major. The git tag is kept, so those versions stay
# buildable from source — we just stop hosting their built artifacts. A managed
# block in the README lists the tag to check out for each pruned major.
#
# Idempotent: safe to run on every version bump (it only ever touches majors
# below the current one, which only exist right after a major increment).
#
# Requires: gh (authenticated via GH_TOKEN), python3, run from the repo root.
set -euo pipefail

cur=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' package.json | head -1)
major=${cur%%.*}
echo "Current version $cur (major $major)"

# 1. Delete releases whose major is below the current one. Keeps the git tag.
gh release list --limit 300 --json tagName --jq '.[].tagName' | while read -r tag; do
  tm=${tag#v}; tm=${tm%%.*}
  [[ "$tm" =~ ^[0-9]+$ ]] || continue
  if (( tm < major )); then
    echo "Removing release binaries for $tag (tag kept for source builds)"
    gh release delete "$tag" --yes
  fi
done

# 2. Rebuild the README "Older versions" block from the remaining tags: the
#    latest tag of each older major is the commit to build that line from.
declare -A last
while read -r v; do
  [[ "$v" =~ ^[0-9]+\. ]] || continue
  m=${v%%.*}
  (( m < major )) && last[$m]="v$v"
done < <(git tag -l 'v*' | sed 's/^v//' | sort -V)

block=$'<!-- OLD-VERSIONS:START -->\n## Older versions\n\n'
if (( ${#last[@]} == 0 )); then
  block+=$'All published releases are builds of the current major version.\n'
else
  block+=$'Older major versions are no longer published as prebuilt binaries (to keep release storage small). Build one from source by checking out the last tag of that major:\n\n'
  for m in $(printf '%s\n' "${!last[@]}" | sort -n); do
    block+="- \`git checkout ${last[$m]} && npm ci && npm run tauri build\` — latest v${m}.x"$'\n'
  done
fi
block+='<!-- OLD-VERSIONS:END -->'

python3 - "$block" <<'PY'
import re, sys, pathlib
block = sys.argv[1]
p = pathlib.Path("README.md")
s = p.read_text()
pat = re.compile(r"<!-- OLD-VERSIONS:START -->.*?<!-- OLD-VERSIONS:END -->", re.S)
if pat.search(s):
    s = pat.sub(lambda _: block, s)
else:  # first run: insert before "## How it works", else append
    marker = "\n## How it works"
    s = s.replace(marker, "\n" + block + "\n" + marker, 1) if marker in s else s.rstrip() + "\n\n" + block + "\n"
pathlib.Path("README.md").write_text(s)
PY

# 3. Commit the refreshed note if it changed. [skip ci] avoids a rebuild loop.
if ! git diff --quiet README.md; then
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git add README.md
  git commit -m "docs: refresh older-versions note after pruning release binaries [skip ci]"
  git push
fi
