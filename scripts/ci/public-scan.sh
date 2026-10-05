#!/bin/sh
# POSIX 래퍼. Windows에서는 node scripts/ci/public-scan.mjs를 직접 부른다(같은 구현).
# 사용: scripts/ci/public-scan.sh [--all-history]
set -eu
exec node "$(dirname "$0")/public-scan.mjs" "$@"
