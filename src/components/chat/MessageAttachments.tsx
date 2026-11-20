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
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => {
            const url = attachmentsRepo.url(projectId, image.id)
            return (
              <a
                key={image.id}
                href={url}
                target="_blank"
                rel="noreferrer"
                title={`${image.name} (buka ukuran penuh)`}
                className="overflow-hidden rounded-lg border border-line bg-white transition hover:border-accent"
              >
                <img src={url} alt={image.name} loading="lazy" className="max-h-40 max-w-full object-contain" />
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
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2.5 py-1.5 text-xs text-ink transition hover:border-accent/40 hover:bg-raised"
            >
              <FileText size={13} className="shrink-0 text-accent" />
              <span className="truncate font-medium">{file.name}</span>
              <span className="shrink-0 text-[11px] text-muted">{describe(file)}</span>
            </a>
          ))}
        </div>
      )}
      {files.some((f) => f.kind === "pdf" && f.textChars === 0) && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
          PDF tanpa teks (hasil scan): hanya model yang bisa membaca PDF (Claude, Gemini) yang bisa melihat isinya. Kirim halaman pentingnya sebagai gambar kalau perlu.
        </p>
      )}
    </div>
  )
}
