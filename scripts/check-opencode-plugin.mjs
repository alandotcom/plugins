#!/usr/bin/env node
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const directory = resolve(process.argv[2] ?? ".")
const location = `location[directory]=${encodeURIComponent(directory)}`
const ids = ["thermos", "thermo-nuclear-review", "thermo-nuclear-code-quality-review"]

async function api(method, path, body) {
  const args = ["api", method, path]
  if (body !== undefined) args.push("--data", JSON.stringify(body))
  const { stdout } = await run("opencode", args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim() ? JSON.parse(stdout) : undefined
}

const plugins = (await api("get", `/api/plugin?${location}`)).data
assert.equal(plugins.find((plugin) => plugin.id === "thermos")?.state.status, "active")

const agents = (await api("get", `/api/agent?${location}`)).data
for (const id of ids.slice(1)) {
  const agent = agents.find((agent) => agent.id === `${id}-subagent`)
  assert.equal(agent?.mode, "subagent")
  assert.ok(agent.system.includes("# Thermos in OpenCode"))
}
const commands = (await api("get", `/api/command?${location}`)).data
assert.ok(commands.some((command) => command.name === "thermos"))

const session = (await api("post", "/api/session", {
  title: "Thermos registration check (no model calls)",
  location: { directory },
})).data
try {
  for (const id of ids) {
    await api("post", `/api/experimental/session/${session.id}/skill`, {
      id: `thermos:${id}`, resume: false,
    })
  }
  const messages = (await api("get", `/api/session/${session.id}/context`)).data
  for (const id of ids) {
    const message = messages.find((message) => message.type === "skill" && message.skill === `thermos:${id}`)
    assert.ok(message?.text.includes("# Thermos in OpenCode"))
    assert.ok(message.text.includes(`${directory}/thermos/skills/thermo-nuclear-review/SKILL.md`))
    assert.ok(message.text.includes(`${directory}/thermos/skills/thermo-nuclear-code-quality-review/SKILL.md`))
    assert.ok(!message.text.includes("agentScope"))
    assert.ok(!message.text.includes("model: opus"))
  }
  console.log("Thermos is active: three packaged skills, both reviewers, and /thermos registered.")
  console.log("Fresh-session skill activation passed without model calls.")
} finally {
  await api("delete", `/api/session/${session.id}`)
}
