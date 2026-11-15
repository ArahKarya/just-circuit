import type { Project, ProjectFiles } from "./types"

export const DEFAULT_ENTRYPOINT = "index.circuit.tsx"

export const STARTER_CODE = `export default () => (
  <board width="20mm" height="15mm">
    <pinheader name="J1" pinCount={2} footprint="pinrow2" pcbX={-6} schX={-4} />
    <resistor name="R1" resistance="330" footprint="0603" pcbX={0} />
    <led name="D1" color="red" footprint="0603" pcbX={6} schX={4} />

    <trace from=".J1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to=".J1 > .pin2" />
  </board>
)
`

export function createProject(name: string, now: number = Date.now()): Project {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "Proyek tanpa nama",
    files: { [DEFAULT_ENTRYPOINT]: STARTER_CODE },
    entrypoint: DEFAULT_ENTRYPOINT,
    createdAt: now,
    updatedAt: now,
  }
}

export function withFiles(project: Project, changes: ProjectFiles, now: number = Date.now()): Project {
  return { ...project, files: { ...project.files, ...changes }, updatedAt: now }
}

export function withoutFile(project: Project, path: string, now: number = Date.now()): Project {
  if (path === project.entrypoint) return project
  const files = Object.fromEntries(Object.entries(project.files).filter(([key]) => key !== path))
  return { ...project, files, updatedAt: now }
}

export function renamed(project: Project, name: string, now: number = Date.now()): Project {
  const trimmed = name.trim()
  return trimmed ? { ...project, name: trimmed, updatedAt: now } : project
}

export function duplicateProject(project: Project, now: number = Date.now()): Project {
  return { ...project, id: crypto.randomUUID(), name: `${project.name} (salinan)`, createdAt: now, updatedAt: now }
}

/** Names exported by a TSX module, e.g. `export const NE555 = ...`. */
export function exportedNames(source: string): string[] {
  const names = [...source.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  return [...new Set(names)]
}

function importSpecifier(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split("/").slice(0, -1)
  const toParts = toFile.replace(/\.(tsx|ts|jsx|js)$/, "").split("/")
  let shared = 0
  while (shared < fromDir.length && fromDir[shared] === toParts[shared]) shared += 1
  const up = fromDir.slice(shared).map(() => "..")
  const rest = toParts.slice(shared)
  const joined = [...up, ...rest].join("/")
  return joined.startsWith(".") ? joined : `./${joined}`
}

export interface ImportedComponent {
  project: Project
  componentName: string | null
  filePath: string
}

/**
 * Adds an imported component (e.g. from JLCPCB) as its own file and imports it
 * into the entrypoint so it can be used right away.
 */
export function addImportedComponent(project: Project, partId: string, tsx: string, now: number = Date.now()): ImportedComponent {
  const safeId = partId.replace(/[^\w-]/g, "_") || "part"
  const filePath = `imports/${safeId}.tsx`
  const componentName = exportedNames(tsx)[0] ?? null
  const entry = project.files[project.entrypoint] ?? ""
  const specifier = importSpecifier(project.entrypoint, filePath)
  const alreadyImported = entry.includes(`"${specifier}"`)
  const nextEntry =
    componentName && !alreadyImported ? `import { ${componentName} } from "${specifier}"\n${entry}` : entry
  return {
    project: withFiles(project, { [filePath]: tsx, [project.entrypoint]: nextEntry }, now),
    componentName,
    filePath,
  }
}

/** Stable key for a set of files, used to match a build result to the code that produced it. */
export function filesKey(files: ProjectFiles): string {
  return JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}
