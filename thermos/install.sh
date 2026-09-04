#!/usr/bin/env bash
# Install the Thermos plugin for Claude Code and opencode from this checkout.
#
# Claude Code reads a plugin from a marketplace, so the script registers this repository as a
# marketplace and installs the plugin from it. opencode has no plugin format for agents and skills,
# so the script symlinks the agent and skill files into the directories opencode scans. Symlinks
# mean a `git pull` in this checkout updates both hosts.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$PLUGIN_DIR/.." && pwd)"
MARKETPLACE_NAME="cursor-plugins"
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

targets="all"
uninstall="no"
for arg in "$@"; do
  case "$arg" in
    claude|opencode|all) targets="$arg" ;;
    --uninstall) uninstall="yes" ;;
    -h|--help)
      echo "usage: install.sh [claude|opencode|all] [--uninstall]"
      exit 0
      ;;
    *)
      echo "install.sh: unknown argument '$arg'" >&2
      exit 2
      ;;
  esac
done

want() { [ "$targets" = "all" ] || [ "$targets" = "$1" ]; }

link_into() {
  # link_into <destination directory> <source path>
  dest_dir="$1"
  src="$2"
  mkdir -p "$dest_dir"
  dest="$dest_dir/$(basename "$src")"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "  skip $dest (a real file or directory is already there)"
    return
  fi
  ln -sfn "$src" "$dest"
  echo "  link $dest"
}

unlink_from() {
  dest="$1/$(basename "$2")"
  if [ -L "$dest" ]; then
    rm "$dest"
    echo "  remove $dest"
  fi
}

if want claude; then
  echo "Claude Code:"
  if ! command -v claude >/dev/null 2>&1; then
    echo "  skip (the claude CLI is not on PATH)"
  elif [ "$uninstall" = "yes" ]; then
    claude plugin uninstall "thermos@$MARKETPLACE_NAME" || true
    claude plugin marketplace remove "$MARKETPLACE_NAME" || true
  else
    claude plugin marketplace add "$REPO_DIR" || true
    claude plugin install "thermos@$MARKETPLACE_NAME"
    echo "  installed. Restart Claude Code, then run /thermos:thermos"
  fi
fi

if want opencode; then
  echo "opencode:"
  for skill in "$PLUGIN_DIR"/skills/*/; do
    if [ "$uninstall" = "yes" ]; then
      unlink_from "$OPENCODE_DIR/skills" "${skill%/}"
    else
      link_into "$OPENCODE_DIR/skills" "${skill%/}"
    fi
  done
  for agent in "$PLUGIN_DIR"/agents/*.md; do
    if [ "$uninstall" = "yes" ]; then
      unlink_from "$OPENCODE_DIR/agents" "$agent"
    else
      link_into "$OPENCODE_DIR/agents" "$agent"
    fi
  done
  [ "$uninstall" = "yes" ] || echo "  installed. Restart opencode, then ask for a thermos review."
fi
