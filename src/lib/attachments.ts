import { extensionOf, formatBytes, kindFromName, MAX_ATTACHMENT_BYTES, type AttachmentKind } from "../../shared/attachments"

/** Longest image edge sent to the AI; bigger photos only cost bandwidth (providers shrink them anyway). */
export const MAX_IMAGE_EDGE = 2048
/** Images under this size and edge are sent untouched. */
const KEEP_IMAGE_BYTES = 3 * 1024 * 1024
/** What a browser may decode before downscaling (a phone photo is 3-12 MB). */
const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024
const JPEG_QUALITY = 0.9

export interface PreparedFile {
  blob: Blob
  name: string
  kind: AttachmentKind
}

const LIMIT_LABEL: Record<AttachmentKind, string> = { image: "Gambar", pdf: "PDF", text: "File teks" }

/** Why a file can't be attached, or null when it can (images are checked again after downscaling). */
export function attachmentProblem(name: string, size: number): string | null {
  const kind = kindFromName(name)
  if (!kind) return `"${name}" tidak didukung. Pakai gambar (PNG/JPG/WebP/GIF), PDF, atau file teks (txt, csv, netlist, KiCad…).`
  const limit = kind === "image" ? MAX_SOURCE_IMAGE_BYTES : MAX_ATTACHMENT_BYTES[kind]
  if (size > limit) return `${LIMIT_LABEL[kind]} "${name}" terlalu besar (${formatBytes(size)}, maksimal ${formatBytes(limit)})`
  if (size === 0) return `"${name}" kosong`
  return null
}

/** Size an image should be scaled to so its longest edge fits; unchanged when already small. */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function withExtension(name: string, ext: string): string {
  const current = extensionOf(name)
  return current ? `${name.slice(0, -current.length)}${ext}` : `${name}${ext}`
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Gagal memproses gambar"))), type, quality))
}

/** Shrinks big images in the browser: line drawings stay PNG, photos become JPEG. */
async function downscale(file: File): Promise<{ blob: Blob; name: string }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`"${file.name}" tidak bisa dibuka sebagai gambar`)
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height)
    const unchanged = size.width === bitmap.width && size.height === bitmap.height
    if (unchanged && file.size <= KEEP_IMAGE_BYTES) return { blob: file, name: file.name }
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Browser tidak bisa memproses gambar")
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    if (file.type === "image/png" || file.type === "image/gif") {
      const png = await encode(canvas, "image/png")
      if (png.size <= KEEP_IMAGE_BYTES) return { blob: png, name: withExtension(file.name, ".png") }
    }
    // JPEG has no transparency: paint white under the image first (schematics are drawn on white).
    context.globalCompositeOperation = "destination-over"
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size.width, size.height)
    return { blob: await encode(canvas, "image/jpeg", JPEG_QUALITY), name: withExtension(file.name, ".jpg") }
  } finally {
    bitmap.close()
  }
}

/** Checks a picked/dropped/pasted file and gets it ready to upload. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  const problem = attachmentProblem(file.name, file.size)
  if (problem) throw new Error(problem)
  const kind = kindFromName(file.name) as AttachmentKind
  if (kind !== "image") return { blob: file, name: file.name, kind }
  const { blob, name } = await downscale(file)
  if (blob.size > MAX_ATTACHMENT_BYTES.image) throw new Error(`Gambar "${file.name}" masih terlalu besar setelah diperkecil`)
  return { blob, name, kind }
}

/** Screenshots pasted from the clipboard arrive as "image.png"; give them a findable name. */
export function namePasted(file: File, now: Date = new Date()): File {
  if (!/^image\.\w+$/i.test(file.name) && file.name) return file
  const stamp = now.toTimeString().slice(0, 8).replace(/:/g, "")
  const ext = extensionOf(file.name) || `.${file.type.split("/")[1] ?? "png"}`
  return new File([file], `tempel-${stamp}${ext}`, { type: file.type })
}
