import { FileText } from "lucide-react"
import { formatBytes } from "../../../shared/attachments"
import { attachmentsRepo } from "../../lib/repo"
import type { AttachmentRef } from "../../lib/types"

interface MessageAttachmentsProps {
  projectId: string
  attachments: readonly AttachmentRef[]
}

function describe(attachment: AttachmentRef): string {
  const pages = attachment.pages ? `${attachment.pages} hlm · ` : ""
  return `${pages}${formatBytes(attachment.size)}`
}

/** Files sent with a chat message: image thumbnails open full size, other files download. */
export function MessageAttachments({ projectId, attachments }: MessageAttachmentsProps) {
  const images = attachments.filter((a) => a.kind === "image")
  const files = attachments.filter((a) => a.kind !== "image")
  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((image) => {
            const url = attachmentsRepo.url(projectId, image.id)
            return (
              <a key={image.id} href={url} target="_blank" rel="noreferrer" title={`${image.name} (buka ukuran penuh)`}>
                <img src={url} alt={image.name} loading="lazy" className="max-h-40 max-w-full rounded-md border border-line bg-white object-contain" />
              </a>
            )
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((file) => (
            <a
              key={file.id}
              href={attachmentsRepo.url(projectId, file.id)}
              download={file.name}
              title="Unduh"
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs hover:bg-raised"
            >
              <FileText size={13} className="shrink-0 text-muted" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-muted">{describe(file)}</span>
            </a>
          ))}
        </div>
      )}
      {files.some((f) => f.kind === "pdf" && f.textChars === 0) && (
        <p className="text-[11px] text-warn">PDF tanpa teks (hasil scan): hanya model yang bisa membaca PDF (Claude, Gemini) yang bisa melihat isinya. Kirim halaman pentingnya sebagai gambar kalau perlu.</p>
      )}
    </div>
  )
}
