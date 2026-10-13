// opencode plugin for Thermos.
//
// Claude Code reads the manifest in `thermos/.claude-plugin/` and loads the skills and agents
// beside this directory by itself. opencode reads no such manifest, so this plugin hands it the
// same two directories through opencode's plugin API: the skills in `../skills` and one subagent
// per file in `../agents`. Both hosts run the same files, so there are no copies to keep in sync.
//
// Install by adding the absolute path of this directory to `plugins` in opencode.json.
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const thermosRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const skillsDirectory = join(thermosRoot, "skills")
const agentsDirectory = join(thermosRoot, "agents")

export default {
  id: "thermos",
  setup: async (ctx) => {
    const host = await readFile(join(thermosRoot, "opencode", "host.md"), "utf8")
    const paths = [
      "skills/thermo-nuclear-review/SKILL.md",
      "skills/thermo-nuclear-code-quality-review/SKILL.md",
      "agents/thermo-nuclear-review-subagent.md",
      "agents/thermo-nuclear-code-quality-review-subagent.md",
    ].map((path) => `- ${join(thermosRoot, path)}`).join("\n")
    const instructions = `${host.trim()}\n\n## Package paths\n\n${paths}\n\n`
    const skills = await readSkills(skillsDirectory)
    await ctx.skill.transform((draft) => {
      for (const skill of skills) {
        draft.add({ ...skill, id: `thermos:${skill.id}`, content: instructions + skill.content })
      }
    })

    await ctx.command.transform((draft) => {
      draft.add({
        name: "thermos",
        description: "Run the packaged Thermos correctness/security and code-quality reviews.",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            delivery,
            skills: [...(prompt.skills ?? []), { id: "thermos:thermos" }],
          })
        },
      })
    })

    const agents = await readAgents(agentsDirectory)
    await ctx.agent.transform((draft) => {
      for (const agent of agents) {
        draft.update(agent.id, (item) => {
          item.system = instructions + agent.system
          item.mode = agent.mode
          if (agent.name !== undefined) item.name = agent.name
          if (agent.description !== undefined) item.description = agent.description
          if (agent.model !== undefined) item.model = agent.model
        })
      }
    })
  },
}

async function readSkills(directory) {
  const names = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const skills = []
  for (const entry of names.filter((item) => item.isDirectory()).sort(byName)) {
    const location = join(directory, entry.name, "SKILL.md")
    const parsed = parseMarkdown(await readFile(location, "utf8").catch(() => undefined))
    if (!parsed) continue
    skills.push({
      id: parsed.fields.name ?? entry.name,
      name: parsed.fields.name ?? entry.name,
      description: parsed.fields.description,
      autoinvoke: parsed.fields["disable-model-invocation"] !== "true",
      path: location,
      content: parsed.body,
    })
  }
  return skills
}

async function readAgents(directory) {
  const names = await readdir(directory).catch(() => [])
  const agents = []
  for (const name of names.filter((item) => item.endsWith(".md")).sort()) {
    const parsed = parseMarkdown(await readFile(join(directory, name), "utf8"))
    if (!parsed || !parsed.body) continue
    const { fields } = parsed
    agents.push({
      // opencode takes an agent's id from its filename, which the `name` field always matches.
      id: name.slice(0, -3),
      name: fields.display_name,
      system: parsed.body,
      mode: fields.mode === "primary" || fields.mode === "all" ? fields.mode : "subagent",
      description: fields.description,
      model: parseModel(fields.model),
    })
  }
  return agents
}

// These files are shared with Claude Code, whose frontmatter is a flat set of `key: value` lines,
// so a full YAML parser would be more than the format can carry.
function parseMarkdown(content) {
  if (!content) return
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content)
  if (!match) return
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator === -1 || /^\s/.test(line)) continue
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1).trim())
  }
  return { fields, body: match[2].trim() }
}

function unquote(value) {
  const quote = value.slice(0, 1)
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
    return value.slice(1, -1)
  }
  return value
}

// `provider/model#variant`, the same spelling opencode.json uses for a model.
function parseModel(value) {
  if (!value) return
  const [reference, variant] = value.split("#")
  const separator = reference.indexOf("/")
  if (separator === -1) return
  return {
    providerID: reference.slice(0, separator),
    id: reference.slice(separator + 1),
    ...(variant ? { variant } : {}),
  }
}

function byName(a, b) {
  return a.name.localeCompare(b.name)
}
