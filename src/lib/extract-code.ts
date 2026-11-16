export interface ExtractedFile {
  path: string
  content: string
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g
const CODE_LANGS = new Set(["tsx", "ts", "jsx", "js", "typescript", "javascript"])
const EDIT_BLOCK = /\bedit\s*=/i
const SAFE_PATH = /^[\w.-]+(\/[\w.-]+)*\.(tsx|ts|jsx|js)$/

function parsePath(info: string): string | null {
  const match = info.match(/(?:file|path|filename)\s*=\s*["']?([^\s"']+)["']?/i)
  if (match) return match[1]
  const bare = info.trim().split(/\s+/).find((token) => SAFE_PATH.test(token))
  return bare ?? null
}

export function isSafePath(path: string): boolean {
  return SAFE_PATH.test(path) && !path.split("/").includes("..")
}

/**
 * Pulls code files out of an assistant reply. Blocks that name a file are
 * applied to that file; an unnamed tsx block is applied to the entrypoint.
 */
export function extractFiles(reply: string, entrypoint: string): ExtractedFile[] {
  const byPath = new Map<string, string>()
  for (const [, info, body] of reply.matchAll(FENCE)) {
    // SEARCH/REPLACE blocks are handled by apply-edits.ts.
    if (EDIT_BLOCK.test(info)) continue
    const lang = info.trim().split(/[\s{]/)[0].toLowerCase()
    const namedPath = parsePath(info)
    if (!namedPath && !CODE_LANGS.has(lang)) continue
    const path = namedPath ?? entrypoint
    if (!isSafePath(path)) continue
    const content = body.replace(/\s+$/, "")
    if (!content.includes("<board") && !content.includes("export")) continue
    byPath.set(path, `${content}\n`)
  }
  return [...byPath].map(([path, content]) => ({ path, content }))
}

/** Text of the reply with code blocks replaced by a short marker, for display. */
export function stripCodeBlocks(reply: string): string {
  return reply.replace(FENCE, (_match, info: string) => {
    const edited = info.match(/\bedit\s*=\s*["']?([^\s"']+)/i)?.[1]
    if (edited) return `\n[edit: ${edited}]\n`
    const path = parsePath(info)
    return path ? `\n[kode: ${path}]\n` : "\n[kode]\n"
  })
}
