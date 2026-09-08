#!/usr/bin/env python3
"""Check plugin discovery and skill loading with the installed Codex CLI."""

import json
import selectors
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MARKETPLACE = Path(".agents/plugins/marketplace.json")


def request(server, selector, request_id, method, params):
    server.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
    server.stdin.flush()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if not selector.select(1):
            continue
        line = server.stdout.readline()
        if not line:
            raise RuntimeError("Codex app-server exited before responding")
        response = json.loads(line)
        if response.get("id") == request_id:
            if "error" in response:
                raise RuntimeError(response["error"])
            return response["result"]
    raise TimeoutError(f"Codex {method} did not respond within 20 seconds")


def check(root):
    entries = json.loads((root / MARKETPLACE).read_text())["plugins"]
    server = subprocess.Popen(
        ["codex", "app-server"], cwd=root, text=True, bufsize=1,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    selector = selectors.DefaultSelector()
    selector.register(server.stdout, selectors.EVENT_READ)
    try:
        request(server, selector, 1, "initialize", {
            "clientInfo": {"name": "plugin-validation", "version": "1.0.0"},
            "capabilities": {"experimentalApi": True},
        })
        server.stdin.write('{"method":"initialized"}\n')
        server.stdin.flush()
        for request_id, entry in enumerate(entries, 2):
            name = entry["name"]
            plugin_root = (root / entry["source"]["path"]).resolve()
            assert plugin_root.is_relative_to(root.resolve()), "Plugin must stay inside marketplace"
            manifest = json.loads((plugin_root / ".codex-plugin/plugin.json").read_text())
            assert manifest["name"] == name
            assert entry["policy"] == {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}
            detail = request(server, selector, request_id, "plugin/read", {
                "marketplacePath": str(root / MARKETPLACE), "pluginName": name,
            })["plugin"]
            expected = {f"{name}:{path.parent.name}" for path in (plugin_root / "skills").glob("*/SKILL.md")}
            actual = {skill["name"] for skill in detail["skills"]}
            assert expected and actual == expected, (name, expected - actual, actual - expected)
            assert detail["summary"]["localVersion"] == manifest["version"]
            assert detail["summary"]["installPolicy"] == "AVAILABLE"
            assert not detail["apps"] and not detail["mcpServers"]
            for skill in detail["skills"]:
                path = Path(skill["path"])
                assert skill["enabled"] and path.is_relative_to(plugin_root)
                assert "[the Codex host guide](../../codex.md)" in path.read_text()
                assert (path.parent / "../../codex.md").resolve().is_file()
            print(f"{name}: Codex loaded all {len(actual)} skills from {root}")
    finally:
        selector.close()
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()


if __name__ == "__main__":
    check(ROOT)
    # Retain the relocated package for inspection; it contains source copies only.
    relocated = Path(tempfile.mkdtemp(prefix="codex-plugin-check-"))
    (relocated / MARKETPLACE).parent.mkdir(parents=True)
    shutil.copy2(ROOT / MARKETPLACE, relocated / MARKETPLACE)
    for entry in json.loads((ROOT / MARKETPLACE).read_text())["plugins"]:
        relative = entry["source"]["path"]
        shutil.copytree(ROOT / relative, relocated / relative,
                        ignore=shutil.ignore_patterns("node_modules", ".git", "__pycache__"))
    check(relocated)
