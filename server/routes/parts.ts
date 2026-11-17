import { Router, type Response } from "express"
import { z } from "zod"
import { MAX_ATTACHMENT_BYTES } from "../../shared/attachments.js"
import { PART_QUERY, PART_SOURCES } from "../../shared/parts.js"
import { config } from "../config.js"
import { errorMessage, logger } from "../logger.js"
import { UrlGuardError } from "../net/url-guard.js"
import { rateLimit } from "../middleware/rate-limit.js"
import { getCatalogPart } from "../parts/catalog.js"
import { convertKicadMod, MAX_KICAD_MOD_CHARS } from "../parts/kicad-mod.js"
import { downloadPublicFile } from "../parts/download.js"
import { searchKicadFootprints, searchParts } from "../parts/sources.js"
import type { AttachmentStore } from "../storage/attachments.js"
import { NotFoundError, ValidationError } from "../storage/errors.js"
import { handle, parseBody, sendData, sendError } from "./http.js"

const DOWNLOADS_PER_MINUTE = 10
/** Each search fans out to six free services: keep well below what would get the server banned. */
const LOOKUPS_PER_MINUTE = 30

const query = z.string().trim().regex(PART_QUERY, "Kata kunci 1-100 karakter: huruf, angka dan tanda baca sederhana")
const searchSchema = z.object({
  q: query,
  sources: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",") : [...PART_SOURCES]))
    .pipe(z.array(z.enum(PART_SOURCES)).min(1)),
})
const catalogSchema = z.object({
  chip: z.string().trim().regex(/^[\w .,\-+/#()%]{1,80}$/, "Nama chip tidak valid"),
  supplier: z.enum(["jlcpcb", "lcsc", "digikey", "mouser"]).optional(),
  spn: z.string().trim().regex(/^[\w.\-+/#]{1,80}$/).optional(),
})
const datasheetSchema = z.object({
  projectId: z.string().min(1).max(100),
  url: z.string().trim().url().max(1000),
  /** Shown in the chat; the part number the datasheet belongs to (cleaned below). */
  name: z.string().trim().min(1).max(80),
})

/** An outside source being down is a 502 with its reason, not a server error. */
async function upstream<T>(res: Response, task: () => Promise<T>): Promise<void> {
  try {
    sendData(res, await task())
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) throw error
    sendError(res, 502, `Sumber part tidak bisa dihubungi: ${error instanceof Error ? error.message.slice(0, 200) : "gagal"}`)
  }
}

const kicadModSchema = z.object({
  fileName: z.string().trim().min(1).max(200).regex(/\.kicad_mod$/i, "Pilih file .kicad_mod"),
  partName: z.string().trim().max(80).optional(),
  content: z.string().min(1).max(MAX_KICAD_MOD_CHARS, "File .kicad_mod terlalu besar (maksimal 512 KB)"),
})

function parseQuery<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join("; "))
  return parsed.data
}

/** Part search across suppliers and libraries, catalog parts, and datasheet downloads into the chat. */
export function partsRouter(attachments: AttachmentStore): Router {
  const r = Router()
  const downloadLimit = rateLimit(DOWNLOADS_PER_MINUTE)
  const lookupLimit = rateLimit(LOOKUPS_PER_MINUTE)

  r.get("/search", lookupLimit, handle(async (req, res) => {
    const { q, sources } = parseQuery(searchSchema, req.query)
    sendData(res, await searchParts(q, sources))
  }))

  r.get("/footprints", lookupLimit, handle(async (req, res) => {
    const { q } = parseQuery(z.object({ q: query }), req.query)
    await upstream(res, () => searchKicadFootprints(q))
  }))

  r.get("/catalog", lookupLimit, handle(async (req, res) => {
    const { chip, supplier, spn } = parseQuery(catalogSchema, req.query)
    await upstream(res, () => getCatalogPart(chip, { supplier, supplierPartNumber: spn }))
  }))

  // The server fetches a datasheet PDF from a public address and files it as a chat attachment.
  r.post("/datasheet", downloadLimit, handle(async (req, res) => {
    const body = parseBody(datasheetSchema, req, res)
    if (!body) return
    let bytes: Buffer
    try {
      // Only E2E runs (loopback dev servers) may fetch from the local mock.
      bytes = (await downloadPublicFile(body.url, MAX_ATTACHMENT_BYTES.pdf, { allowPrivate: config.isE2e })).bytes
    } catch (error) {
      // Policy refusals are explained; network details (status codes, refused ports) stay in the log.
      logger.warn("datasheet download failed", { error: errorMessage(error) })
      const reason = error instanceof UrlGuardError ? ` (${error.message})` : ""
      throw new ValidationError(`Datasheet tidak bisa diunduh${reason}. Buka link-nya, unduh PDF-nya, lalu lampirkan manual di chat.`)
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new ValidationError("Link datasheet ini bukan file PDF (mungkin halaman web). Buka link-nya, unduh PDF-nya, lalu lampirkan manual di chat.")
    }
    const name = body.name.replace(/[^\w .,\-+#()%]+/g, "-").replace(/\s+/g, " ").trim() || "part"
    sendData(res, await attachments.add(body.projectId, `${name} datasheet.pdf`, bytes), 201)
  }))

  // A footprint file the user downloaded (manufacturer, SnapEDA, Ultra Librarian) becomes a component.
  r.post("/kicad-mod", lookupLimit, handle(async (req, res) => {
    const body = parseBody(kicadModSchema, req, res)
    if (body) sendData(res, convertKicadMod(body.content, body.fileName, body.partName))
  }))

  return r
}
