import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("the installed root entrypoint exposes both workflows without unnamespaced skill collisions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const { default: plugin } = await import(new URL(`../${manifest.main}`, import.meta.url))
  const skills = new Map()
  const commands = new Map()
  const agents = new Map()
  await plugin.setup({
    options: {},
    permission: { async hook() {} },
    skill: { async transform(update) { update({ add(skill) {
      assert.ok(!skills.has(skill.id), `Duplicate skill: ${skill.id}`)
      skills.set(skill.id, skill)
    } }) } },
    command: { async transform(update) { update({ add(command) { commands.set(command.name, command) } }) } },
    agent: { async transform(update) { update({ update(id, change) {
      const agent = agents.get(id) ?? { id }
      change(agent)
      agents.set(id, agent)
    } }) } },
  })
  assert.equal(plugin.id, "alandotcom.plugins")
  assert.ok(skills.has("thermos:thermos"))
  assert.ok(skills.has("pstack:poteto-mode"))
  assert.ok(commands.has("thermos"))
  assert.ok(commands.has("setup-pstack"))
  assert.ok(agents.has("thermo-nuclear-review-subagent"))
  assert.ok(agents.has("poteto-agent"))
})
