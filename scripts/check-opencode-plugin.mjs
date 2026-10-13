#!/usr/bin/env node
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const directory = resolve(process.argv[2] ?? ".")
const location = `location[directory]=${encodeURIComponent(directory)}`
const mode = process.argv[3] ?? "bundle"
const packages = mode === "bundle" ? ["thermos", "pstack"] : [mode]
assert.ok(packages.every((name) => name === "thermos" || name === "pstack"), "Use bundle, thermos, or pstack")

async function api(method, path, body) {
  const args = ["api", method, path]
  if (body !== undefined) args.push("--data", JSON.stringify(body))
  const { stdout } = await run("opencode", args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim() ? JSON.parse(stdout) : undefined
}

const plugins = (await api("get", `/api/plugin?${location}`)).data
assert.equal(plugins.find((plugin) => plugin.id === (mode === "bundle" ? "alandotcom.plugins" : mode))?.state.status, "active")
const commands = (await api("get", `/api/command?${location}`)).data
for (const name of packages) {
  const agentIDs = name === "thermos"
    ? ["thermo-nuclear-review-subagent", "thermo-nuclear-code-quality-review-subagent"]
    : ["poteto-agent", "comment-sicko"]
  const agents = await Promise.all(agentIDs.map(async (id) =>
    (await api("get", `/api/agent/${id}?${location}`)).data))
  for (const agent of agents) {
    assert.equal(agent.mode, "subagent")
    assert.ok(agent.system.includes(name === "thermos" ? "# Thermos in OpenCode" : "# pstack in OpenCode"))
  }
  const root = name === "thermos"
    ? agents[0].system.match(/^- (.+)\/skills\/thermo-nuclear-review\/SKILL.md$/m)?.[1]
    : agents[0].system.match(/^PSTACK_ROOT: (.+)$/m)?.[1]
  assert.ok(root, `Missing installed ${name} resource path`)
  const entries = await readdir(resolve(root, "skills"), { withFileTypes: true })
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  assert.ok(ids.length)
  for (const id of ids) {
    const command = name === "thermos" ? "thermos" : `pstack:${id}`
    assert.ok(commands.some((item) => item.name === command), `Missing /${command}`)
    const session = (await api("post", "/api/session", {
      title: `${name} skill check (no model calls)`,
      location: { directory },
    })).data
    try {
      await api("post", `/api/experimental/session/${session.id}/skill`, { id: `${name}:${id}`, resume: false })
      const messages = (await api("get", `/api/session/${session.id}/context`)).data
      const message = messages.find((item) => item.type === "skill" && item.skill === `${name}:${id}`)
      assert.ok(message?.text.includes(name === "thermos" ? "# Thermos in OpenCode" : "# pstack in OpenCode"))
      assert.ok(message.text.includes(root))
      assert.ok(!messages.some((item) => item.type === "assistant"), "Skill checks must not call models")
    } finally {
      await api("delete", `/api/session/${session.id}`)
    }
  }
  console.log(`${name}: both agents, commands, and all ${ids.length} fresh-session skill activations passed without model calls.`)
  if (name === "pstack") {
    const session = (await api("post", "/api/session", {
      title: "Comment Sicko permission check (no model calls)",
      agent: "comment-sicko",
      location: { directory },
    })).data
    try {
      for (const action of ["edit", "shell", "subagent", "execute", "qa_write_record"]) {
        const result = (await api("post", `/api/session/${session.id}/permission`, {
          agent: "comment-sicko", action, resources: ["*"],
        })).data
        assert.equal(result.effect, "deny", `Comment Sicko must deny ${action}`)
      }
      console.log("pstack: live reviewer permission checks deny local, delegated, and external mutations.")
    } finally {
      await api("delete", `/api/session/${session.id}`)
    }
  }
}
