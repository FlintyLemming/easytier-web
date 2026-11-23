#!/usr/bin/env bash
# Switch the test env's web container from one easytier image tag to another,
# backing up the web data dir first.
#
# Usage: bash testenv/upgrade.sh <from_tag> <to_tag>
#   e.g. bash testenv/upgrade.sh v2.6.4 v2.7.1   (upgrade)
#        bash testenv/upgrade.sh v2.7.1 v2.6.4   (downgrade; restore a backup afterwards)
#
# Only the web service is touched; core1..3 keep running.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <from_tag> <to_tag>" >&2
  exit 2
fi
from_tag=$1
to_tag=$2

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
compose_file="$here/docker-compose.yml"
compose=(docker compose -f "$compose_file")

# Same default as docker-compose.yml; a relative ET_DATA_DIR is relative to the compose file.
data_dir=${ET_DATA_DIR:-./data}
case "$data_dir" in
  /*) ;;
  *) data_dir="$here/${data_dir#./}" ;;
esac
if [ ! -d "$data_dir" ]; then
  echo "data dir not found: $data_dir" >&2
  exit 1
fi

# Refuse to run if web is up on a tag other than <from_tag>.
running_image=$("${compose[@]}" ps --status running --format '{{.Image}}' web 2>/dev/null || true)
if [ -n "$running_image" ] && [ "$running_image" != "easytier/easytier:$from_tag" ]; then
  echo "web is running $running_image, expected easytier/easytier:$from_tag" >&2
  exit 1
fi
if [ -z "$running_image" ]; then
  echo "note: web is not running; continuing"
fi

echo "stopping web ($from_tag)"
"${compose[@]}" stop web

backup_dir="$here/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$here/backups"
if [ -e "$backup_dir" ]; then
  echo "backup dir already exists: $backup_dir" >&2
  exit 1
fi
cp -a "$data_dir" "$backup_dir"

echo "starting web ($to_tag)"
ET_WEB_TAG="$to_tag" "${compose[@]}" up -d web

echo "backup: $backup_dir"
