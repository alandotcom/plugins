import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { isAbsolute } from "node:path"
import test from "node:test"
import plugin from "./index.js"

async function register() {
  const skills = new Map()
  const commands = new Map()
  const prompts = []
  const agents = new Map([
    ["thermo-nuclear-review-subagent", {
      model: { providerID: "configured", id: "reviewer" },
      permissions: [{ action: "edit", resource: "*", effect: "deny" }],
    }],
  ])
  await plugin.setup({
    command: {
      async transform(update) {
        update({ add(command) { commands.set(command.name, command) } })
      },
    },
    session: { async prompt(input) { prompts.push(input) } },
    skill: {
      async transform(update) {
        update({
          add(skill) {
            assert.ok(isAbsolute(skill.path), "V2 skills require an absolute path")
            const allowed = ["id", "name", "description", "autoinvoke", "path", "content"]
            assert.ok(Object.keys(skill).every((key) => allowed.includes(key)))
            skills.set(skill.id, skill)
          },
        })
      },
    },
    agent: {
      async transform(update) {
        update({
          update(id, change) {
            const agent = agents.get(id) ?? { id, permissions: [] }
            change(agent)
            agents.set(id, agent)
          },
        })
      },
    },
  })
  return { skills, agents, commands, prompts }
}

test("registers all three Thermos skills using the V2 schema", async () => {
  const { skills } = await register()
  assert.deepEqual([...skills.keys()].sort(), [
    "thermos:thermo-nuclear-code-quality-review", "thermos:thermo-nuclear-review", "thermos:thermos",
  ])
  for (const skill of skills.values()) {
    assert.equal(skill.autoinvoke, false)
    assert.ok(skill.content.length > 100)
  }
})

test("the thermos command selects the packaged workflow and preserves prompt attachments", async () => {
  const { commands, prompts } = await register()
  const prompt = {
    text: "Review this branch",
    files: [{ uri: "file:///review.patch" }],
    skills: [{ id: "other" }],
  }
  await commands.get("thermos").execute({ sessionID: "session", prompt, delivery: "queue" })
  assert.deepEqual(prompts, [{
    ...prompt, sessionID: "session", delivery: "queue",
    skills: [{ id: "other" }, { id: "thermos:thermos" }],
  }])
  assert.deepEqual(prompt.skills, [{ id: "other" }])
})

test("registers both reviewer agents without replacing configured models or permissions", async () => {
  const { agents } = await register()
  assert.equal(agents.size, 2)
  assert.deepEqual(agents.get("thermo-nuclear-review-subagent").model,
    { providerID: "configured", id: "reviewer" })
  assert.deepEqual(agents.get("thermo-nuclear-review-subagent").permissions,
    [{ action: "edit", resource: "*", effect: "deny" }])
  for (const agent of agents.values()) {
    assert.equal(agent.mode, "subagent")
    assert.ok(agent.system.includes("RUBRIC_PATH"))
  }
})

test("OpenCode skills and reviewers receive OpenCode dispatch and absolute rubric paths", async () => {
  const { skills, agents } = await register()
  for (const entry of [...skills.values(), ...agents.values()]) {
    const instructions = entry.content ?? entry.system
    assert.ok(instructions.includes("# Thermos in OpenCode"))
    assert.ok(instructions.includes("subagent"))
    assert.ok(instructions.includes("/thermos/skills/thermo-nuclear-review/SKILL.md"))
    assert.ok(instructions.includes("/thermos/skills/thermo-nuclear-code-quality-review/SKILL.md"))
    assert.ok(!instructions.includes("agentScope"))
    assert.ok(!instructions.includes("~/.pi/"))
  }
})

test("shared reviewers inherit host tools and can locate a plugin rubric without a parent path", async () => {
  for (const name of ["thermo-nuclear-review", "thermo-nuclear-code-quality-review"]) {
    const content = await readFile(new URL(`../agents/${name}-subagent.md`, import.meta.url), "utf8")
    assert.ok(!/^tools:/m.test(content), "Shared agents must inherit valid host tool names")
    assert.ok(content.includes("CLAUDE_PLUGIN_ROOT"))
    assert.ok(content.includes("CURSOR_PLUGIN_ROOT"))
    assert.ok(content.includes(`skills/${name}/SKILL.md`))
  }
})
