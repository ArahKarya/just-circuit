import { Bot, CircleStop, Eraser, RotateCcw, SendHorizontal, Settings2, TriangleAlert, User } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { ChatState } from "../hooks/useChat"
import { stripCodeBlocks } from "../lib/extract-code"
import type { ChatMessage, Connection } from "../lib/types"
import { Button, IconButton } from "./ui"

interface ChatPanelProps {
  chat: ChatState
  connection: Connection | undefined
  connectionProblem: string | null
  onOpenSettings: () => void
}

const EXAMPLE_PROMPTS = [
  "Buat rangkaian LED berkedip pakai IC 555, sumber 9V",
  "Tambahkan regulator 3.3V AMS1117 dengan kapasitor input/output",
  "Buat breakout board ESP32-C3 dengan header 2x8 dan tombol reset",
]

interface MessageBubbleProps {
  message: ChatMessage
  canUndo: boolean
  onUndo: (message: ChatMessage) => void
}

function MessageBubble({ message, canUndo, onUndo }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const text = isUser ? message.content : stripCodeBlocks(message.content).trim()
  return (
    <li className="flex gap-2.5">
      <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-raised" : "bg-accent/15 text-accent"}`}>
        {isUser ? <User size={14} /> : message.isError ? <TriangleAlert size={14} className="text-danger" /> : <Bot size={14} />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${message.isError ? "text-danger" : ""}`}>{text}</p>
        {message.appliedFiles && message.appliedFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-accent">Diterapkan: {message.appliedFiles.join(", ")}</span>
            {canUndo && message.previousFiles && (
              <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onUndo(message)}>
                <RotateCcw size={12} /> Batalkan
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export function ChatPanel({ chat, connection, connectionProblem, onOpenSettings }: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const lastAppliedId = [...chat.messages].reverse().find((m) => m.previousFiles)?.id

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [chat.messages.length, chat.streamingText])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || chat.isBusy) return
    setDraft("")
    void chat.send(text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) submit()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs text-muted">
        <button type="button" onClick={onOpenSettings} className="flex min-w-0 items-center gap-1.5 truncate rounded px-1.5 py-1 hover:bg-raised hover:text-ink">
          <Settings2 size={13} />
          <span className="truncate">{connection ? `${connection.name} · ${connection.model || "model belum diisi"}` : "Atur koneksi AI"}</span>
        </button>
        <IconButton label="Hapus riwayat chat" onClick={() => void chat.clear()} disabled={chat.isBusy || chat.messages.length === 0}>
          <Eraser size={15} />
        </IconButton>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {chat.messages.length === 0 && !chat.isBusy ? (
          <div className="space-y-3 text-sm text-muted">
            <p>Jelaskan rangkaian yang kamu mau. AI akan menulis kode tscircuit dan preview langsung diperbarui.</p>
            {connectionProblem && (
              <p className="rounded-md border border-danger/40 bg-danger/10 p-2.5 text-danger">
                {connectionProblem}{" "}
                <button type="button" className="underline" onClick={onOpenSettings}>Buka Pengaturan</button>
              </p>
            )}
            <ul className="space-y-1.5">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button type="button" className="w-full rounded-md border border-line px-3 py-2 text-left text-ink hover:bg-raised" onClick={() => setDraft(prompt)}>
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="space-y-5">
            {chat.messages.map((message) => (
              <MessageBubble key={message.id} message={message} canUndo={message.id === lastAppliedId && !chat.isBusy} onUndo={(m) => void chat.undo(m)} />
            ))}
            {chat.isBusy && (
              <li className="flex gap-2.5">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Bot size={14} /></div>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
                  {stripCodeBlocks(chat.streamingText).trim() || "Sedang berpikir…"}
                </p>
              </li>
            )}
          </ul>
        )}
      </div>

      {chat.autoFixRemaining > 0 && chat.isBusy && (
        <p className="shrink-0 px-4 pb-1 text-xs text-muted">Memperbaiki error build otomatis…</p>
      )}
      <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2 focus-within:border-accent">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            aria-label="Pesan untuk AI"
            placeholder="Contoh: tambahkan LED indikator power di pin 3V3"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-muted/60 focus:outline-none"
          />
          {chat.isBusy ? (
            <Button variant="danger" onClick={chat.stop} aria-label="Hentikan"><CircleStop size={16} /></Button>
          ) : (
            <Button variant="primary" type="submit" disabled={!draft.trim()} aria-label="Kirim"><SendHorizontal size={16} /></Button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">Enter untuk kirim · Shift+Enter baris baru</p>
      </form>
    </div>
  )
}
