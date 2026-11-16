/** Long-lived notes the AI always sees: one for the project, one for the user across projects. */
export const MAX_MEMORY_CHARS = 8000

export interface MemoryNotes {
  project: string[]
  global: string[]
}

const MEMORY_FENCE = /```memory([^\n`]*)\n([\s\S]*?)```/g

function toLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, 300))
}

/** Notes the AI asked to remember: ```memory (project) or ```memory scope=global. */
export function extractMemoryNotes(reply: string): MemoryNotes {
  const notes: MemoryNotes = { project: [], global: [] }
  for (const [, info, body] of reply.matchAll(MEMORY_FENCE)) {
    const scope = /scope\s*=\s*["']?global/i.test(info) ? "global" : "project"
    notes[scope].push(...toLines(body))
  }
  return notes
}

const normalize = (line: string): string => line.toLowerCase().replace(/\s+/g, " ").trim()

/**
 * Appends new notes as "- " bullets, skipping ones already written. Returns null when nothing
 * new was added; throws when the memory would exceed its size limit.
 */
export function appendMemory(existing: string, notes: readonly string[]): string | null {
  const known = new Set(toLines(existing).map(normalize))
  const fresh = notes.filter((note) => {
    const key = normalize(note)
    if (known.has(key)) return false
    known.add(key)
    return true
  })
  if (fresh.length === 0) return null
  const base = existing.trimEnd()
  const next = `${base ? `${base}\n` : ""}${fresh.map((note) => `- ${note}`).join("\n")}\n`
  if (next.length > MAX_MEMORY_CHARS) throw new Error(`Memori penuh (maks ${MAX_MEMORY_CHARS} karakter). Rapikan di Pengaturan → Memori.`)
  return next
}
