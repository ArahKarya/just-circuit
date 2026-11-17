import { CircleStop, FileText, LoaderCircle, Paperclip, SendHorizontal, X } from "lucide-react"
import { useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react"
import { ATTACHMENT_ACCEPT } from "../../../shared/attachments"
import type { AttachmentDraft, DraftAttachment } from "../../hooks/useAttachmentDraft"
import { namePasted } from "../../lib/attachments"
import { Button, IconButton } from "../ui"

/** Sent when the user attaches files without typing anything. */
export const DEFAULT_ATTACHMENT_REQUEST = "Buatkan rangkaian dari lampiran ini."

interface ChatComposerProps {
  draft: string
  onDraftChange: (text: string) => void
  attachments: AttachmentDraft
  canAttach: boolean
  isBusy: boolean
  onSend: (text: string) => void
  onStop: () => void
}

function DraftChip({ item, onRemove }: { item: DraftAttachment; onRemove: () => void }) {
  return (
    <li
      className={`flex max-w-48 items-center gap-1.5 rounded-md border py-1 pl-1 pr-0.5 text-xs ${item.status === "error" ? "border-danger/50 text-danger" : "border-line"}`}
      title={item.error ?? item.name}
    >
      {item.previewUrl ? (
        <img src={item.previewUrl} alt="" className="size-8 shrink-0 rounded object-cover" />
      ) : (
        <FileText size={16} className="mx-1 shrink-0 text-muted" />
      )}
      <span className="min-w-0 flex-1 truncate">{item.status === "error" ? item.error : item.name}</span>
      {item.status === "uploading" && <LoaderCircle size={13} className="shrink-0 animate-spin text-muted" aria-label="Mengunggah" />}
      <IconButton label={`Hapus lampiran ${item.name}`} className="size-6 shrink-0" onClick={onRemove}>
        <X size={12} />
      </IconButton>
    </li>
  )
}

export function ChatComposer({ draft, onDraftChange, attachments, canAttach, isBusy, onSend, onStop }: ChatComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const ready = attachments.items.some((item) => item.status === "ready")
  const canSend = !isBusy && !attachments.isUploading && (draft.trim() !== "" || ready)

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend) return
    onSend(draft.trim() || DEFAULT_ATTACHMENT_REQUEST)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  // Screenshots pasted with Cmd/Ctrl+V become attachments; pasted text still pastes as text.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files]
    if (files.length === 0 || !canAttach) return
    if (!event.clipboardData.types.includes("text/plain")) event.preventDefault()
    attachments.add(files.map((file) => namePasted(file)))
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
      <div className="rounded-lg border border-line bg-surface p-2 focus-within:border-accent">
        {attachments.items.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Lampiran">
            {attachments.items.map((item) => (
              <DraftChip key={item.key} item={item} onRemove={() => attachments.remove(item.key)} />
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <IconButton label="Lampirkan file (gambar, PDF, teks)" className="size-8 shrink-0" disabled={!canAttach} onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} />
          </IconButton>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={ATTACHMENT_ACCEPT}
            data-testid="chat-file-input"
            onChange={(event) => {
              attachments.add([...(event.target.files ?? [])])
              event.target.value = ""
            }}
          />
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={2}
            aria-label="Pesan untuk AI"
            placeholder="Contoh: tambahkan LED indikator power di pin 3V3"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-muted/60 focus:outline-none"
          />
          {isBusy ? (
            <Button variant="danger" onClick={onStop} aria-label="Hentikan"><CircleStop size={16} /></Button>
          ) : (
            <Button variant="primary" type="submit" disabled={!canSend} aria-label="Kirim"><SendHorizontal size={16} /></Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">Enter untuk kirim · Shift+Enter baris baru · seret atau tempel file untuk melampirkan</p>
    </form>
  )
}
