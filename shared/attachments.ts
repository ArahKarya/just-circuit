/** Files the user attaches to a chat message (reference schematics, datasheets, netlists…). */

export type AttachmentKind = "image" | "pdf" | "text"

export interface AttachmentMeta {
  id: string
  name: string
  kind: AttachmentKind
  mediaType: string
  /** Bytes as stored (images are already downscaled by the browser). */
  size: number
  /** PDF only. */
  pages?: number
  /** PDF only: characters of text found (0 for scans). */
  textChars?: number
  createdAt: number
}

export const MAX_ATTACHMENTS_PER_MESSAGE = 6

export const MAX_ATTACHMENT_BYTES: Record<AttachmentKind, number> = {
  image: 8 * 1024 * 1024,
  pdf: 32 * 1024 * 1024,
  text: 2 * 1024 * 1024,
}

/** Largest upload the server accepts (the biggest of the limits above). */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_ATTACHMENT_BYTES))

export const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

/** Text formats worth reading as references: notes, netlists, KiCad/Eagle files, code. */
export const TEXT_EXTENSIONS = [
  ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml",
  ".tsx", ".ts", ".jsx", ".js", ".ino", ".c", ".h", ".cpp", ".hpp", ".py",
  ".net", ".cir", ".sp", ".spice", ".kicad_sch", ".kicad_pcb", ".kicad_sym", ".kicad_mod", ".kicad_pro", ".sch", ".brd", ".lbr",
]

export const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Value for <input type="file" accept>. */
export const ATTACHMENT_ACCEPT = [...Object.keys(IMAGE_MEDIA_TYPES), ".pdf", ...TEXT_EXTENSIONS].join(",")

export function extensionOf(name: string): string {
  const match = /\.[^./\\]+$/.exec(name.toLowerCase())
  return match ? match[0] : ""
}

/** Kind of a file from its name, or null when Just Circuit can't send it to the AI. */
export function kindFromName(name: string): AttachmentKind | null {
  const ext = extensionOf(name)
  if (ext in IMAGE_MEDIA_TYPES) return "image"
  if (ext === ".pdf") return "pdf"
  if (TEXT_EXTENSIONS.includes(ext)) return "text"
  return null
}

const MAX_NAME_CHARS = 120

/** A display name that is safe to store and show: no folders, no control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  // Control, line-separator and invisible format characters (e.g. right-to-left override that hides the real extension).
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f\u2028\u2029]|\p{Cf}/gu, "").trim()
  if (clean.length <= MAX_NAME_CHARS) return clean || "lampiran"
  const ext = extensionOf(clean).slice(0, 20)
  return `${clean.slice(0, MAX_NAME_CHARS - ext.length)}${ext}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** What the chat request carries per message: ids only, the server reads the files. */
export type AttachmentRef = Pick<AttachmentMeta, "id" | "name" | "kind" | "mediaType" | "size" | "pages" | "textChars">
