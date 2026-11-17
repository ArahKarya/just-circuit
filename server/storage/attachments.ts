import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Worker } from "node:worker_threads"
import {
  ATTACHMENT_ID,
  cleanFileName,
  formatBytes,
  kindFromName,
  MAX_ATTACHMENT_BYTES,
  type AttachmentKind,
  type AttachmentMeta,
  type AttachmentRef,
} from "../../shared/attachments.js"
import { errorMessage, logger } from "../logger.js"
import { NotFoundError, ValidationError } from "./errors.js"
import { isDirectory, isRegularFile, readOwnJson, writeFileAtomic, writeJsonFile } from "./fs-utils.js"
import type { ProjectStore } from "./projects.js"

/** Text kept from a PDF; a long datasheet is clipped further when it is sent. */
const MAX_PDF_TEXT_CHARS = 300_000
const MAX_PDF_PAGES_READ = 300
const PDF_TIMEOUT_MS = 60_000
const PDF_WORKER_MEMORY_MB = 768
/** Uploads that never made it into a message (tab closed before sending) are removed after this. */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000
/** Per project, so one chat can't fill the disk. */
export const MAX_PROJECT_ATTACHMENT_BYTES = 300 * 1024 * 1024
export const MAX_PROJECT_ATTACHMENTS = 300

/** Media type from the file's first bytes; the browser's claim is never trusted. */
export function sniffImage(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp"
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) return "image/gif"
  return null
}

/** UTF-8 text without NUL bytes, or null for binary data. */
export function decodeText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return text.includes("\u0000") ? null : text.replace(/^﻿/, "")
  } catch {
    return null
  }
}

interface PdfText {
  pages: number
  /** Pages the text was read from (the first MAX_PDF_PAGES_READ). */
  readPages: number
  text: string
}

type WorkerReply = PdfText | { error: "password" | "broken" }

let pdfQueue: Promise<unknown> = Promise.resolve()

/** One PDF at a time, each in a worker thread with a memory cap and a time limit. */
export function readPdfText(bytes: Buffer, timeoutMs = PDF_TIMEOUT_MS): Promise<PdfText> {
  const next = pdfQueue.then(() => readPdfInWorker(bytes, timeoutMs))
  pdfQueue = next.catch(() => undefined)
  return next
}

function readPdfInWorker(bytes: Buffer, timeoutMs: number): Promise<PdfText> {
  return new Promise((resolve, reject) => {
    const data = new Uint8Array(bytes)
    const worker = new Worker(new URL("./pdf-text-worker.mjs", import.meta.url), {
      workerData: { bytes: data, maxPages: MAX_PDF_PAGES_READ, maxChars: MAX_PDF_TEXT_CHARS },
      transferList: [data.buffer],
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB },
    })
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      action()
    }
    const timer = setTimeout(() => finish(() => reject(new ValidationError("PDF terlalu lama dibaca, coba bagi jadi beberapa file atau kirim halaman pentingnya"))), timeoutMs)
    worker.once("message", (reply: WorkerReply) =>
      finish(() => {
        if ("error" in reply) reject(new ValidationError(reply.error === "password" ? "PDF dikunci password, buka kuncinya dulu" : "PDF rusak atau tidak bisa dibaca"))
        else resolve(reply)
      }),
    )
    worker.once("error", (error) =>
      finish(() => {
        logger.warn("pdf worker failed", { error: errorMessage(error) })
        reject(new ValidationError("PDF terlalu berat untuk dibaca"))
      }),
    )
    worker.once("exit", () => finish(() => reject(new ValidationError("PDF tidak bisa dibaca"))))
  })
}

export function tooBigMessage(kind: AttachmentKind, size: number): string {
  const label = { image: "Gambar", pdf: "PDF", text: "File teks" }[kind]
  return `${label} terlalu besar (${formatBytes(size)}, maksimal ${formatBytes(MAX_ATTACHMENT_BYTES[kind])})`
}

interface Inspected {
  kind: AttachmentKind
  mediaType: string
  pages?: number
  text?: string
}

/** Checks the bytes match the file type and works out what to store. */
async function inspect(name: string, bytes: Buffer): Promise<Inspected> {
  const kind = kindFromName(name)
  if (!kind) throw new ValidationError(`Jenis file "${name}" tidak didukung. Pakai gambar (PNG/JPG/WebP/GIF), PDF, atau file teks (txt, csv, netlist, KiCad…).`)
  if (bytes.length === 0) throw new ValidationError(`"${name}" kosong`)
  if (bytes.length > MAX_ATTACHMENT_BYTES[kind]) throw new ValidationError(tooBigMessage(kind, bytes.length))
  if (kind === "image") {
    const mediaType = sniffImage(bytes)
    if (!mediaType) throw new ValidationError(`"${name}" bukan gambar PNG/JPG/WebP/GIF yang valid`)
    return { kind, mediaType }
  }
  if (kind === "pdf") {
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ValidationError(`"${name}" bukan file PDF yang valid`)
    const { pages, readPages, text } = await readPdfText(bytes)
    const note = readPages < pages && text ? `\n\n[Teks hanya diambil dari ${readPages} halaman pertama dari ${pages}.]` : ""
    return { kind, mediaType: "application/pdf", pages, text: text + note }
  }
  const text = decodeText(bytes)
  if (text === null) throw new ValidationError(`"${name}" bukan file teks (UTF-8)`)
  return { kind, mediaType: "text/plain", text }
}

export type AttachmentStore = ReturnType<typeof createAttachmentStore>

const FILE_NAME = /^([0-9a-f-]{36})\.(json|bin|txt)$/

/** Attachments live in <project>/.cds/attachments: outside version history, removed with the chat. */
export function createAttachmentStore(projects: Pick<ProjectStore, "pathOf" | "withProject" | "messages">) {
  /** The attachments folder; refuses a .cds or attachments folder that is a symlink (it could point anywhere). */
  async function folderIn(projectDir: string, create: boolean): Promise<string | null> {
    const cds = path.join(projectDir, ".cds")
    if (!(await isDirectory(cds))) throw new Error("Folder .cds proyek bukan folder biasa")
    const dir = path.join(cds, "attachments")
    const info = await lstat(dir).catch(() => null)
    if (info && !info.isDirectory()) throw new Error("Folder lampiran bukan folder biasa")
    if (info) return dir
    if (!create) return null
    await mkdir(dir)
    return dir
  }

  const files = (dir: string, id: string) => ({ meta: path.join(dir, `${id}.json`), data: path.join(dir, `${id}.bin`), text: path.join(dir, `${id}.txt`) })

  async function usage(dir: string): Promise<{ bytes: number; count: number }> {
    let bytes = 0
    let count = 0
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith(".bin")) continue
      count += 1
      bytes += (await stat(path.join(dir, entry)).catch(() => null))?.size ?? 0
    }
    return { bytes, count }
  }

  async function add(projectId: string, rawName: string, bytes: Buffer): Promise<AttachmentMeta> {
    const name = cleanFileName(rawName)
    await projects.pathOf(projectId)
    // Reading a PDF can take a while: do it before taking the project lock.
    const found = await inspect(name, bytes)
    const meta = await projects.withProject(projectId, async (projectDir) => {
      const dir = (await folderIn(projectDir, true)) as string
      const used = await usage(dir)
      if (used.count >= MAX_PROJECT_ATTACHMENTS || used.bytes + bytes.length > MAX_PROJECT_ATTACHMENT_BYTES) {
        throw new ValidationError(`Lampiran proyek ini sudah penuh (${used.count} file, ${formatBytes(used.bytes)}). Hapus riwayat chat untuk mengosongkannya.`)
      }
      const id = randomUUID()
      const record: AttachmentMeta = {
        id,
        name,
        kind: found.kind,
        mediaType: found.mediaType,
        size: bytes.length,
        ...(found.kind === "pdf" ? { pages: found.pages, textChars: found.text?.length ?? 0 } : {}),
        createdAt: Date.now(),
      }
      const paths = files(dir, id)
      try {
        await writeFile(paths.data, bytes, { mode: 0o600, flag: "wx" })
        if (found.kind === "pdf" && found.text) await writeFileAtomic(paths.text, found.text, { mode: 0o600 })
        // The meta file goes last: an attachment exists only once it is complete.
        await writeJsonFile(paths.meta, record, { mode: 0o600 })
      } catch (error) {
        await removeFiles(dir, id)
        throw error
      }
      return record
    })
    void purgeOrphans(projectId).catch((error: unknown) => logger.warn("attachment cleanup failed", { error: errorMessage(error) }))
    return meta
  }

  async function locateMeta(projectId: string, id: string): Promise<{ dir: string; meta: AttachmentMeta }> {
    if (!ATTACHMENT_ID.test(id)) throw new NotFoundError("Lampiran tidak ditemukan")
    const dir = await folderIn(await projects.pathOf(projectId), false)
    const found = dir ? await readOwnJson<AttachmentMeta | null>(files(dir, id).meta, null).catch(() => null) : null
    if (!dir || !found || found.id !== id) throw new NotFoundError("Lampiran tidak ditemukan")
    return { dir, meta: found }
  }

  /** What is stored about an attachment, without reading the file itself. */
  async function info(projectId: string, id: string): Promise<AttachmentMeta> {
    return (await locateMeta(projectId, id)).meta
  }

  async function get(projectId: string, id: string): Promise<{ meta: AttachmentMeta; bytes: Buffer }> {
    const { dir, meta } = await locateMeta(projectId, id)
    const file = files(dir, id).data
    if (!(await isRegularFile(file))) throw new NotFoundError("Lampiran tidak ditemukan")
    return { meta, bytes: await readFile(file) }
  }

  /** Readable text: a text file's content, or what was extracted from a PDF ("" for a scan). */
  async function text(projectId: string, id: string): Promise<string> {
    const { dir, meta } = await locateMeta(projectId, id)
    const paths = files(dir, id)
    const file = meta.kind === "pdf" ? paths.text : paths.data
    if (meta.kind === "image" || !(await isRegularFile(file))) return ""
    return readFile(file, "utf8")
  }

  /** The stored description of attachments a message refers to; unknown ids are dropped. */
  async function refsFor(projectId: string, ids: readonly string[]): Promise<AttachmentRef[]> {
    const refs: AttachmentRef[] = []
    for (const id of new Set(ids)) {
      const meta = await info(projectId, id).catch(() => null)
      if (meta) refs.push({ id: meta.id, name: meta.name, kind: meta.kind, mediaType: meta.mediaType, size: meta.size, ...(meta.pages !== undefined ? { pages: meta.pages, textChars: meta.textChars } : {}) })
    }
    return refs
  }

  async function referenced(projectId: string): Promise<Set<string>> {
    const messages = await projects.messages(projectId)
    return new Set(messages.flatMap((m) => m.attachments?.map((a) => a.id) ?? []))
  }

  async function removeFiles(dir: string, id: string): Promise<void> {
    const paths = files(dir, id)
    await Promise.all([paths.meta, paths.data, paths.text].map((file) => rm(file, { force: true })))
  }

  /** Removes an upload that was not sent yet; attachments of sent messages stay with the chat. */
  async function remove(projectId: string, id: string): Promise<void> {
    await locateMeta(projectId, id)
    if ((await referenced(projectId)).has(id)) throw new ValidationError("Lampiran ini sudah terkirim di chat; hapus riwayat chat untuk menghapusnya")
    await projects.withProject(projectId, async (projectDir) => {
      const dir = await folderIn(projectDir, false)
      if (dir) await removeFiles(dir, id)
    })
  }

  function clear(projectId: string): Promise<void> {
    return projects.withProject(projectId, async (projectDir) => {
      const dir = await folderIn(projectDir, false)
      if (dir) await rm(dir, { recursive: true, force: true })
    })
  }

  /** Removes uploads no message refers to once they are a day old, and leftovers of failed uploads. */
  async function purgeOrphans(projectId: string, now = Date.now()): Promise<number> {
    const keep = await referenced(projectId)
    return projects.withProject(projectId, async (projectDir) => {
      const dir = await folderIn(projectDir, false)
      if (!dir) return 0
      const ids = new Set<string>()
      for (const entry of await readdir(dir)) {
        const match = FILE_NAME.exec(entry)
        if (match && ATTACHMENT_ID.test(match[1]) && !keep.has(match[1])) ids.add(match[1])
      }
      let removed = 0
      for (const id of ids) {
        const paths = files(dir, id)
        const meta = await readOwnJson<AttachmentMeta | null>(paths.meta, null).catch(() => null)
        const born = meta?.createdAt ?? (await stat(paths.data).catch(() => null))?.mtimeMs ?? 0
        if (now - born < ORPHAN_AGE_MS) continue
        await removeFiles(dir, id)
        removed += 1
      }
      return removed
    })
  }

  return { add, info, get, text, refsFor, remove, clear, purgeOrphans }
}
