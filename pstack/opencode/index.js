import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const shortcuts = new Set(["poteto-mode", "setup-pstack", "poteto-help"])
const readOnlyActions = new Set(["read", "glob", "grep", "skill", "webfetch", "websearch", "external_directory"])

export default {
  id: "pstack",
  async setup(ctx) {
    const models = await resolveModels(ctx)
    const host = await readFile(join(root, "opencode/host.md"), "utf8")
    const instructions = `${host.trim()}\n\n## Installed package\n\n` +
      `PSTACK_ROOT: ${root}\n` +
      `POTETO_MODE_PATH: ${join(root, "skills/poteto-mode/SKILL.md")}\n` +
      `HOST_GUIDE_PATH: ${join(root, "opencode/host.md")}\n\n` +
      `## OpenCode role models\n\n${JSON.stringify(models, null, 2)}\n\n`
    const entries = await readdir(join(root, "skills"), { withFileTypes: true })
    const skills = await Promise.all(entries.filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
        const path = join(root, "skills", entry.name, "SKILL.md")
        const { fields, body } = parseMarkdown(await readFile(path, "utf8"), path)
        return {
          id: `pstack:${fields.name ?? entry.name}`,
          name: fields.name ?? entry.name,
          description: fields.description,
          autoinvoke: fields["disable-model-invocation"] !== "true",
          path,
          content: instructions + body,
        }
      }))

    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
    await ctx.command.transform((editor) => {
      for (const skill of skills) {
        const command = {
          name: skill.id,
          description: skill.description,
          execute: async ({ sessionID, prompt, delivery }) => ctx.session.prompt({
            ...prompt,
            sessionID,
            delivery,
            skills: [...(prompt.skills ?? []), { id: skill.id }],
          }),
        }
        editor.add(command)
        if (shortcuts.has(skill.name)) editor.add({ ...command, name: skill.name })
      }
    })

    const names = (await readdir(join(root, "agents"))).filter((name) => name.endsWith(".md")).sort()
    const agents = await Promise.all(names.map(async (name) => {
      const path = join(root, "agents", name)
      const { fields, body } = parseMarkdown(await readFile(path, "utf8"), path)
      return { id: name.slice(0, -3), description: fields.description, system: instructions + body }
    }))
    await ctx.agent.transform((editor) => {
      for (const agent of agents) {
        editor.update(agent.id, (item) => {
          item.system = agent.system
          item.description = agent.description
          item.mode = "subagent"
          if (agent.id === "comment-sicko") {
            item.permissions = [...(item.permissions ?? []),
              { action: "edit", resource: "*", effect: "deny" },
              { action: "shell", resource: "*", effect: "deny" },
              { action: "subagent", resource: "*", effect: "deny" },
            ]
          }
        })
      }
    })
    await ctx.permission.hook("evaluate", (event) => {
      if (event.agent === "comment-sicko" && !readOnlyActions.has(event.action)) {
        event.effect = "deny"
        event.message = "Comment Sicko performs read-only reviews."
      }
    })
  },
}

function parseMarkdown(content, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content)
  if (!match) throw new Error(`Missing Markdown frontmatter: ${path}`)
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator === -1 || /^\s/.test(line)) continue
    let value = line.slice(separator + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'")
    fields[line.slice(0, separator).trim()] = value
  }
  return { fields, body: match[2].trim() }
}

async function resolveModels(ctx) {
  const models = ctx.options?.models === undefined ? {} : ctx.options.models
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    throw new Error("pstack options.models must be a role-to-model object")
  }
  const references = Object.values(models).flatMap((value) => Array.isArray(value) ? value : [value])
  if (Object.values(models).some((value) => Array.isArray(value) && value.length === 0) ||
      references.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("pstack role models must be model IDs or nonempty lists of model IDs")
  }
  const explicit = references.filter((value) => value !== "auto" && value !== "inherit-parent")
  if (explicit.length) {
    const { data: available } = await ctx.model.list()
    for (const reference of explicit) {
      const [id, variant, extra] = reference.split("#")
      const model = available.find((item) => `${item.providerID}/${item.id}` === id && item.enabled)
      if (extra !== undefined || !model || (variant !== undefined && !model.variants.some((item) => item.id === variant))) {
        throw new Error(`Unavailable pstack model: ${reference}`)
      }
    }
  }
  return models
}
