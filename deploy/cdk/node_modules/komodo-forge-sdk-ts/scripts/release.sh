#!/usr/bin/env bash
# release.sh — bump version in package.json, build, commit, tag, and push.
#
# Usage:
#   pnpm release patch          # 0.2.0 → 0.2.1
#   pnpm release minor          # 0.2.0 → 0.3.0
#   pnpm release major          # 0.2.0 → 1.0.0
#   pnpm release 1.5.0          # explicit version
set -euo pipefail
source "$(dirname "$0")/_lib.sh"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
BUMP="${1:-}"

# ---------------------------------------------------------------------------
# Working tree must be clean
# ---------------------------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  log_error "Working tree is dirty — commit or stash all changes before releasing."
  exit 1
fi

ROOT="$(repo_root)"
PKG="$ROOT/package.json"
CHANGELOG="$ROOT/CHANGELOG.md"

# ---------------------------------------------------------------------------
# Read current version from package.json
# ---------------------------------------------------------------------------
current=$(node -p "require('$PKG').version")
log_info "Current version: $current"

# ---------------------------------------------------------------------------
# Determine new version
# ---------------------------------------------------------------------------
case "$BUMP" in
  "")
    # Extract version from CHANGELOG (first version found)
    if [[ -f "$CHANGELOG" ]]; then
      new_version=$(grep -E '\[[0-9]+\.[0-9]+\.[0-9]+\]' "$CHANGELOG" | head -1 | sed 's/.*\[\([0-9.]*\)\].*/\1/')
      if [[ -z "$new_version" ]]; then
        log_error "Could not extract version from CHANGELOG.md"
        exit 1
      fi
      log_info "Extracted version from CHANGELOG: $new_version"
    else
      log_error "CHANGELOG.md not found"
      exit 1
    fi
    ;;
  patch)
    IFS='.' read -r major minor patch <<< "$current"
    new_version="$major.$minor.$((patch + 1))"
    ;;
  minor)
    IFS='.' read -r major minor patch <<< "$current"
    new_version="$major.$((minor + 1)).0"
    ;;
  major)
    IFS='.' read -r major minor patch <<< "$current"
    new_version="$((major + 1)).0.0"
    ;;
  [0-9]*)
    new_version="$BUMP"
    ;;
  *)
    log_error "Unknown bump type '$BUMP'. Use patch, minor, major, or an explicit version."
    exit 1
    ;;
esac

changelog_version=$(grep -E '\[[0-9]+\.[0-9]+\.[0-9]+\]' "$CHANGELOG" | head -1 | sed 's/.*\[\([0-9.]*\)\].*/\1/')

if [[ -z "$BUMP" ]]; then
  if [[ "$changelog_version" != "$current" ]]; then
    log_error "CHANGELOG latest version ($changelog_version) does not match package.json ($current) — update one to match before releasing."
    exit 1
  fi
else
  if [[ "$changelog_version" != "$new_version" ]]; then
    log_error "CHANGELOG latest version ($changelog_version) does not match target version ($new_version) — add a CHANGELOG entry for v$new_version before releasing."
    exit 1
  fi
fi

log_section "Releasing $current → $new_version"

# ---------------------------------------------------------------------------
# Update package.json version
# ---------------------------------------------------------------------------
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
  pkg.version = '$new_version';
  fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
"
log_success "package.json updated to $new_version"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
log_section "Building"
pnpm run build
log_success "Build passed"

# ---------------------------------------------------------------------------
# Commit, tag, push
# ---------------------------------------------------------------------------
log_section "Committing and tagging"
git add "$PKG"

# Include dist/ if it is tracked (in-repo distribution pattern)
if git ls-files --error-unmatch dist/ &>/dev/null 2>&1; then
  git add dist/
fi

git commit -m "chore: release v$new_version"
git tag "v$new_version"
git push origin "v$new_version"
log_success "Tagged and pushed v$new_version"

log_section "Done"
log_info "Release v$new_version is live. Don't forget to:"
log_info "  • Push the branch if you haven't: git push origin <branch>"
log_info "  • Update CHANGELOG.md once the versioning strategy is settled"
