import { randomBytes } from "node:crypto"
import type { FilePart, ImagePart, ModelMessage, TextPart } from "ai"
import type { AttachmentMeta } from "../../shared/attachments.js"
import type { Connection } from "./schema.js"

/** A chat turn as the browser sends it: attachments are ids of files stored with the project. */
export interface TurnWithAttachments {
  role: "user" | "assistant"
  content: string
  attachments?: string[]
}

/** Reads attachments lazily: the size is checked against the budget before a file is read. */
export interface AttachmentSource {
  info: (id: string) => Promise<AttachmentMeta | null>
  bytes: (id: string) => Promise<Buffer | null>
  text: (id: string) => Promise<string>
}

export interface PartBudget {
  /** Raw bytes of images and PDFs in one request (base64 adds a third on top). */
  binaryBytes: number
  /** Characters of attached text (text files, PDF text) in one request. */
  textChars: number
  images: number
  /** Characters of one text attachment; longer ones are clipped. */
  perFileChars: number
  /** PDFs up to this many pages go to Claude/Gemini as the file itself (pages are seen as images). */
  nativePdfPages: number
  nativePdfBytes: number
}

export const DEFAULT_BUDGET: PartBudget = {
  binaryBytes: 18 * 1024 * 1024,
  textChars: 240_000,
  images: 16,
  perFileChars: 120_000,
  nativePdfPages: 20,
  nativePdfBytes: 10 * 1024 * 1024,
}

type UserPart = TextPart | ImagePart | FilePart

/** Providers that read PDF files natively (layout, drawings and tables included). */
function readsPdf(kind: Connection["kind"]): boolean {
  return kind === "anthropic" || kind === "gemini"
}

function clip(text: string, limit: number): { text: string; clipped: boolean } {
  return text.length > limit ? { text: text.slice(0, limit), clipped: true } : { text, clipped: false }
}

interface Remaining {
  binaryBytes: number
  textChars: number
  images: number
  /** Ids already attached in a later turn of this request (each file is sent once). */
  sent: Set<string>
  /** Random marker around attached text, so a file can't fake the end of its own block. */
  fence: string
}

/** Header the model sees before each attachment, so it can tell them apart and name them. */
const label = (meta: AttachmentMeta, note = "") => `[Lampiran: ${meta.name}${meta.pages ? `, ${meta.pages} halaman` : ""}${note}]`

async function partsFor(id: string, source: AttachmentSource, kind: Connection["kind"], budget: PartBudget, left: Remaining): Promise<UserPart[]> {
  const meta = await source.info(id)
  if (!meta) return [{ type: "text", text: "[Lampiran sudah dihapus]" }]
  if (left.sent.has(id)) return [{ type: "text", text: label(meta, " — sama dengan lampiran di pesan berikutnya") }]
  left.sent.add(id)
  const skipped = (why: string): UserPart[] => [{ type: "text", text: label(meta, ` — tidak dikirim ulang: ${why}`) }]

  if (meta.kind === "image") {
    if (left.images <= 0) return skipped("terlalu banyak gambar dalam percakapan")
    if (meta.size > left.binaryBytes) return skipped("batas ukuran lampiran per permintaan")
    const bytes = await source.bytes(id)
    if (!bytes) return [{ type: "text", text: "[Lampiran sudah dihapus]" }]
    left.images -= 1
    left.binaryBytes -= bytes.length
    return [{ type: "text", text: label(meta) }, { type: "image", image: bytes, mediaType: meta.mediaType }]
  }

  if (meta.kind === "pdf" && readsPdf(kind) && (meta.pages ?? Infinity) <= budget.nativePdfPages && meta.size <= Math.min(budget.nativePdfBytes, left.binaryBytes)) {
    const bytes = await source.bytes(id)
    if (bytes) {
      left.binaryBytes -= bytes.length
      return [{ type: "text", text: label(meta) }, { type: "file", data: bytes, mediaType: "application/pdf", filename: meta.name }]
    }
  }

  const raw = await source.text(id)
  if (!raw.trim()) {
    return [{ type: "text", text: label(meta, " — tidak ada teks yang bisa dibaca (mungkin hasil scan). Minta pengguna mengirim halaman pentingnya sebagai gambar.") }]
  }
  if (left.textChars <= 0) return skipped("batas teks lampiran per permintaan")
  const { text, clipped } = clip(raw, Math.min(budget.perFileChars, left.textChars))
  left.textChars -= text.length
  const note = meta.kind === "pdf" ? ", teks hasil ekstraksi" : ""
  const tail = clipped ? "\n[…dipotong; minta pengguna menyebut halaman/bagian yang perlu dibaca]" : ""
  return [{ type: "text", text: `${label(meta, note)}\n<<<${left.fence}\n${text}${tail}\n${left.fence}>>>` }]
}

/**
 * Turns chat turns into model messages, putting attached files in as images, PDF files or text.
 * The newest attachments are added first, so when a conversation holds more than fits in one
 * request it is the oldest ones that are replaced by a note.
 */
export async function buildModelMessages(
  turns: readonly TurnWithAttachments[],
  source: AttachmentSource,
  kind: Connection["kind"],
  budget: PartBudget = DEFAULT_BUDGET,
  fence: string = `lampiran-${randomBytes(6).toString("hex")}`,
): Promise<ModelMessage[]> {
  const left: Remaining = { binaryBytes: budget.binaryBytes, textChars: budget.textChars, images: budget.images, sent: new Set(), fence }
  const built: ModelMessage[] = []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.role === "assistant" || !turn.attachments?.length) {
      built.push(turn.role === "assistant" ? { role: "assistant", content: turn.content } : { role: "user", content: turn.content })
      continue
    }
    const parts: UserPart[] = []
    for (const id of turn.attachments) parts.push(...(await partsFor(id, source, kind, budget, left)))
    built.push({ role: "user", content: [...parts, { type: "text", text: turn.content }] })
  }
  return built.reverse()
}

/** True when any turn carries attachments (the request then needs the project id). */
export function hasAttachments(turns: readonly TurnWithAttachments[]): boolean {
  return turns.some((turn) => (turn.attachments?.length ?? 0) > 0)
}
