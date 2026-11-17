import { Bot, Eraser, Paperclip, RotateCcw, Settings2, TriangleAlert, User, Workflow } from "lucide-react"
import { useEffect, useRef, useState, type DragEvent } from "react"
import { useAttachmentDraft } from "../hooks/useAttachmentDraft"
import type { ChatState } from "../hooks/useChat"
import { stripCodeBlocks } from "../lib/extract-code"
import type { ChatMessage, Connection } from "../lib/types"
import { PendingReply } from "./PendingReply"
import { ChatComposer } from "./chat/ChatComposer"
import { MessageAttachments } from "./chat/MessageAttachments"
import { ToolSteps } from "./ToolSteps"
import { IconButton } from "./ui"

interface ChatPanelProps {
  /** Project the chat belongs to (attachments are stored with it). */
  projectId: string | undefined
  chat: ChatState
  connection: Connection | undefined
  connectionProblem: string | null
  onOpenSettings: () => void
  agentMode: boolean
  onToggleAgent: () => void
  /** Opens the terminal and runs a command the agent proposed (the user clicked it). */
  onRunCommand: (command: string) => void
}

const EXAMPLE_PROMPTS = [
  "Buat rangkaian LED berkedip pakai IC 555, sumber 9V",
  "Tambahkan regulator 3.3V AMS1117 dengan kapasitor input/output",
  "Buat breakout board ESP32-C3 dengan header 2x8 dan tombol reset",
]

interface MessageBubbleProps {
  message: ChatMessage
  projectId: string | undefined
  canUndo: boolean
  onUndo: (message: ChatMessage) => void
  onRunCommand: (command: string) => void
}

function MessageBubble({ message, projectId, canUndo, onUndo, onRunCommand }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const text = isUser ? message.content : stripCodeBlocks(message.content).trim()
  return (
    <li className="flex gap-2.5">
      <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-raised" : "bg-accent/15 text-accent"}`}>
        {isUser ? <User size={14} /> : message.isError ? <TriangleAlert size={14} className="text-danger" /> : <Bot size={14} />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {message.toolSteps && message.toolSteps.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none hover:text-ink">{message.toolSteps.length} langkah agen</summary>
            <div className="mt-1.5">
              <ToolSteps steps={message.toolSteps} />
            </div>
          </details>
        )}
        {message.toolSteps?.some((step) => step.name === "propose_command") && (
          <ToolSteps steps={message.toolSteps.filter((step) => step.name === "propose_command")} onRunCommand={onRunCommand} />
        )}
        {projectId && message.attachments && message.attachments.length > 0 && <MessageAttachments projectId={projectId} attachments={message.attachments} />}
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

/** True when a drag carries files (not text or a link dragged from the page). */
const draggingFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files")

export function ChatPanel({ projectId, chat, connection, connectionProblem, onOpenSettings, agentMode, onToggleAgent, onRunCommand }: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const attachments = useAttachmentDraft(projectId)
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const lastAppliedId = [...chat.messages].reverse().find((m) => m.previousFiles)?.id

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [chat.messages.length, chat.streamingText, chat.reasoningText])

  const send = (text: string) => {
    setDraft("")
    void chat.send(text, attachments.take())
  }

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!draggingFiles(event) || !projectId) return
      dragDepth.current += 1
      setDropping(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!draggingFiles(event) || !projectId) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: (event: DragEvent) => {
      if (!draggingFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDropping(false)
    },
    onDrop: (event: DragEvent) => {
      if (!draggingFiles(event) || !projectId) return
      event.preventDefault()
      dragDepth.current = 0
      setDropping(false)
      attachments.add([...event.dataTransfer.files])
    },
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...dropHandlers}>
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-sm text-ink backdrop-blur-[1px]">
          Lepas untuk melampirkan (gambar, PDF, teks)
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs text-muted">
        <button type="button" onClick={onOpenSettings} className="flex min-w-0 items-center gap-1.5 truncate rounded px-1.5 py-1 hover:bg-raised hover:text-ink">
          <Settings2 size={13} />
          <span className="truncate">{connection ? `${connection.name} · ${connection.model || "model belum diisi"}` : "Atur koneksi AI"}</span>
        </button>
        <button
          type="button"
          aria-pressed={agentMode}
          title="Mode agen: AI membaca/menulis file, menjalankan build, dan mencari part sendiri"
          onClick={onToggleAgent}
          className={`ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-1 ${agentMode ? "bg-accent/15 text-accent" : "hover:bg-raised hover:text-ink"}`}
        >
          <Workflow size={13} /> Mode agen
        </button>
        <IconButton label="Hapus riwayat chat" onClick={() => void chat.clear()} disabled={chat.isBusy || chat.messages.length === 0}>
          <Eraser size={15} />
        </IconButton>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {chat.messages.length === 0 && !chat.isBusy ? (
          <div className="space-y-3 text-sm text-muted">
            <p>Jelaskan rangkaian yang kamu mau. AI akan menulis kode tscircuit dan preview langsung diperbarui.</p>
            <p className="flex gap-1.5">
              <Paperclip size={14} className="mt-0.5 shrink-0" />
              <span>Bisa juga dari referensi: lampirkan gambar skematik, foto board, datasheet PDF, netlist atau file KiCad (klik klip, seret file ke sini, atau tempel screenshot), lalu minta "buatkan PCB dari ini".</span>
            </p>
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
              <MessageBubble key={message.id} message={message} projectId={projectId} canUndo={message.id === lastAppliedId && !chat.isBusy} onUndo={(m) => void chat.undo(m)} onRunCommand={onRunCommand} />
            ))}
            {chat.isBusy && <PendingReply streamingText={chat.streamingText} reasoningText={chat.reasoningText} busySince={chat.busySince} toolSteps={chat.toolSteps} />}
          </ul>
        )}
      </div>

      {chat.autoFixRemaining > 0 && chat.isBusy && (
        <p className="shrink-0 px-4 pb-1 text-xs text-muted">Memperbaiki error build otomatis…</p>
      )}
      <ChatComposer
        draft={draft}
        onDraftChange={setDraft}
        attachments={attachments}
        canAttach={Boolean(projectId)}
        isBusy={chat.isBusy}
        onSend={send}
        onStop={chat.stop}
      />
    </div>
  )
}
