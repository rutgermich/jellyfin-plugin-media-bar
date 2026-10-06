#!/bin/bash
# Prepends a version entry to manifest.json (keeps the newest 10).
# Usage: update-manifest.sh <version> <targetAbi> <md5> <sourceUrl> <changelog>
set -euo pipefail

manifest="$(dirname "$0")/../../manifest.json"
tmp="$(mktemp)"

jq --arg version "$1" --arg abi "$2" --arg checksum "$3" --arg url "$4" --arg changelog "$5" \
   --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.[0].versions = ([{
        version: $version,
        changelog: $changelog,
        targetAbi: $abi,
        sourceUrl: $url,
        checksum: $checksum,
        timestamp: $timestamp
      }] + (.[0].versions | map(select(.version != $version))))[:10]' \
   "$manifest" > "$tmp"

mv "$tmp" "$manifest"
