import assert from "node:assert/strict"
import { isAbsolute } from "node:path"
import test from "node:test"
import plugin from "./index.js"

async function register(options = {}, available = []) {
  const skills = new Map()
  const commands = new Map()
  const prompts = []
  const permissionHooks = []
  const agents = new Map([
    ["poteto-agent", {
      model: { providerID: "configured", id: "code" },
      permissions: [{ action: "read", resource: "secrets/**", effect: "deny" }],
    }],
    ["comment-sicko", {
      model: { providerID: "configured", id: "review" },
      permissions: [{ action: "read", resource: "secrets/**", effect: "deny" }],
    }],
  ])
  await plugin.setup({
    options,
    model: { async list() { return { data: available } } },
    skill: { async transform(update) { update({ add(skill) { skills.set(skill.id, skill) } }) } },
    command: { async transform(update) { update({ add(command) { commands.set(command.name, command) } }) } },
    session: { async prompt(input) { prompts.push(input) } },
    permission: { async hook(name, update) { permissionHooks.push(update) } },
    agent: {
      async transform(update) {
        update({ update(id, change) { change(agents.get(id)) } })
      },
    },
  })
  return { skills, agents, commands, prompts, permissionHooks }
}

test("pstack exposes its mode, setup, routed skills, and principles with relocatable resource paths", async () => {
  const { skills } = await register()
  for (const name of ["poteto-mode", "setup-pstack", "how", "interrogate", "principle-type-system-discipline"]) {
    const skill = skills.get(`pstack:${name}`)
    assert.ok(skill, `${name} must be selectable`)
    assert.ok(isAbsolute(skill.path))
    assert.ok(skill.content.includes("# pstack in OpenCode"))
    assert.ok(skill.content.includes("POTETO_MODE_PATH:"))
  }
  assert.equal(skills.get("pstack:poteto-mode").autoinvoke, false)
  assert.equal(skills.get("pstack:setup-pstack").autoinvoke, true)
})

test("shortcut and namespaced commands select the packaged skill without losing prompt inputs", async () => {
  const { commands, prompts } = await register()
  const prompt = {
    text: "Explain the publication flow",
    files: [{ uri: "file:///scope.md" }],
    skills: [{ id: "other" }],
    agents: [{ id: "existing" }],
  }
  for (const name of ["poteto-mode", "pstack:how"]) {
    await commands.get(name).execute({ sessionID: "session", prompt, delivery: "queue" })
  }
  assert.deepEqual(prompts, ["pstack:poteto-mode", "pstack:how"].map((id) => ({
    ...prompt, sessionID: "session", delivery: "queue",
    skills: [{ id: "other" }, { id }],
  })))
  assert.deepEqual(prompt.skills, [{ id: "other" }])
})

test("pstack retains configured agent models and permissions while restricting Comment Sicko mutations", async () => {
  const { agents, permissionHooks } = await register()
  assert.deepEqual(agents.get("poteto-agent").model, { providerID: "configured", id: "code" })
  assert.deepEqual(agents.get("poteto-agent").permissions,
    [{ action: "read", resource: "secrets/**", effect: "deny" }])
  const reviewer = agents.get("comment-sicko")
  assert.deepEqual(reviewer.model, { providerID: "configured", id: "review" })
  assert.deepEqual(reviewer.permissions[0], { action: "read", resource: "secrets/**", effect: "deny" })
  for (const action of ["edit", "shell", "subagent"]) {
    assert.ok(reviewer.permissions.some((rule) => rule.action === action && rule.resource === "*" && rule.effect === "deny"))
  }
  for (const agent of agents.values()) {
    assert.equal(agent.mode, "subagent")
    assert.ok(agent.system.includes("HOST_GUIDE_PATH:"))
  }
  for (const action of ["edit", "shell", "subagent", "execute", "mcp_update_record"]) {
    const event = { agent: "comment-sicko", action, effect: "allow" }
    for (const update of permissionHooks) update(event)
    assert.equal(event.effect, "deny", `${action} must remain denied after global allow rules`)
  }
  for (const event of [
    { agent: "comment-sicko", action: "read", effect: "ask" },
    { agent: "poteto-agent", action: "edit", effect: "allow" },
  ]) {
    const original = event.effect
    for (const update of permissionHooks) update(event)
    assert.equal(event.effect, original)
  }
})

test("confirmed available role models reach skills without replacing native agent model preferences", async () => {
  const options = { models: { "interrogate reviewers": ["verified/code#high", "inherit-parent"] } }
  const { skills, agents } = await register(options, [{
    providerID: "verified", id: "code", enabled: true, variants: [{ id: "high" }],
  }])
  assert.ok(skills.get("pstack:interrogate").content.includes('"verified/code#high"'))
  assert.deepEqual(agents.get("poteto-agent").model, { providerID: "configured", id: "code" })
})

test("invalid or unavailable model choices fail registration instead of silently changing models", async () => {
  for (const models of [{ feature: "verified/code#high#not-a-variant" }, null, [],
    { feature: [] }, { feature: 7 }, { feature: "missing/model" }, { feature: "verified/code#missing" }]) {
    await assert.rejects(register({ models }, [{
      providerID: "verified", id: "code", enabled: true, variants: [{ id: "high" }],
    }]), /pstack.*model/i)
  }
})
