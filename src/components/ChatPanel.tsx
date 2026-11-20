import { ArrowUpRight, Bot, ChevronRight, Eraser, Paperclip, RotateCcw, Settings2, Sparkles, TriangleAlert, User, Workflow } from "lucide-react"
import { useEffect, useRef, useState, type DragEvent } from "react"
import { useAttachmentDraft } from "../hooks/useAttachmentDraft"
import type { ChatState } from "../hooks/useChat"
import { stripCodeBlocks } from "../lib/extract-code"
import type { AttachmentRef, ChatMessage, Connection } from "../lib/types"
import { PendingReply } from "./PendingReply"
import { ToolSteps } from "./ToolSteps"
import { ChatComposer } from "./chat/ChatComposer"
import { MessageAttachments } from "./chat/MessageAttachments"
import { IconButton } from "./ui"

/** A message prepared elsewhere (part search) and put in the box for the user to review and send. */
export interface ChatDraftRequest {
  text: string
  attachments: AttachmentRef[]
  nonce: number
}

interface ChatPanelProps {
  /** Project the chat belongs to (attachments are stored with it). */
  projectId: string | undefined
  draftRequest?: ChatDraftRequest | null
  /** Called once the request is in the box, so a remount doesn't add it again. */
  onDraftRequestHandled?: () => void
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
      <div
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border ${
          isUser
            ? "border-line bg-raised text-muted"
            : message.isError
              ? "border-danger/35 bg-danger/10 text-danger"
              : "border-accent/25 bg-accent/12 text-accent"
        }`}
      >
        {isUser ? <User size={14} /> : message.isError ? <TriangleAlert size={14} /> : <Bot size={14} />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {message.toolSteps && message.toolSteps.length > 0 && (
          <details className="group rounded-lg border border-line bg-surface/60 text-xs text-muted">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 font-medium select-none hover:text-ink">
              <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
              {message.toolSteps.length} langkah agen
            </summary>
            <div className="border-t border-line p-2">
              <ToolSteps steps={message.toolSteps} />
            </div>
          </details>
        )}
        {message.toolSteps?.some((step) => step.name === "propose_command") && (
          <ToolSteps steps={message.toolSteps.filter((step) => step.name === "propose_command")} onRunCommand={onRunCommand} />
        )}
        {projectId && message.attachments && message.attachments.length > 0 && (
          <MessageAttachments projectId={projectId} attachments={message.attachments} />
        )}
        {text && (
          <div
            className={
              isUser
                ? "rounded-xl border border-line bg-raised/70 px-3 py-2 text-sm leading-relaxed text-ink"
                : message.isError
                  ? "rounded-xl border border-danger/35 bg-danger/8 px-3 py-2 text-sm leading-relaxed text-danger"
                  : "text-sm leading-relaxed text-ink"
            }
          >
            <p className="whitespace-pre-wrap break-words">{text}</p>
          </div>
        )}
        {message.appliedFiles && message.appliedFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
              Diterapkan: {message.appliedFiles.join(", ")}
            </span>
            {canUndo && message.previousFiles && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface/60 px-2 py-0.5 text-[11px] font-medium text-muted transition hover:bg-raised hover:text-ink"
                onClick={() => onUndo(message)}
              >
                <RotateCcw size={11} /> Batalkan
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

export function ChatPanel({
  projectId,
  draftRequest,
  onDraftRequestHandled,
  chat,
  connection,
  connectionProblem,
  onOpenSettings,
  agentMode,
  onToggleAgent,
  onRunCommand,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const attachments = useAttachmentDraft(projectId)
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Only a new request fills the box; attachments.addReady is stable.
  useEffect(() => {
    if (!draftRequest) return
    // Added below what the user was typing, never over it.
    setDraft((current) => (current.trim() ? `${current.trimEnd()}\n\n${draftRequest.text}` : draftRequest.text))
    attachments.addReady(draftRequest.attachments)
    onDraftRequestHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRequest?.nonce])
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
        <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent/10 text-sm font-medium text-ink backdrop-blur-[2px]">
          <Paperclip size={20} className="text-accent" />
          Lepas untuk melampirkan (gambar, PDF, teks)
        </div>
      )}

      {/* Sub-toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface/35 px-3 py-1.5 text-xs">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex min-w-0 items-center gap-1.5 truncate rounded-md border border-transparent px-2 py-1 text-muted transition hover:border-line hover:bg-raised hover:text-ink"
        >
          <span className={`size-1.5 shrink-0 rounded-full ${connectionProblem ? "bg-danger" : "bg-accent"}`} />
          <Settings2 size={13} className="shrink-0" />
          <span className="truncate font-medium">
            {connection ? `${connection.name} · ${connection.model || "model belum diisi"}` : "Atur koneksi AI"}
          </span>
        </button>

        <button
          type="button"
          aria-pressed={agentMode}
          title="Mode agen: AI membaca/menulis file, menjalankan build, dan mencari part sendiri"
          onClick={onToggleAgent}
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition ${
            agentMode
              ? "border-accent/35 bg-accent/12 text-accent"
              : "border-transparent text-muted hover:border-line hover:bg-raised hover:text-ink"
          }`}
        >
          <Workflow size={13} />
          Mode agen
        </button>

        <IconButton
          label="Hapus riwayat chat"
          className="size-7"
          onClick={() => void chat.clear()}
          disabled={chat.isBusy || chat.messages.length === 0}
        >
          <Eraser size={14} />
        </IconButton>
      </div>

      {/* Messages / Empty state */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {chat.messages.length === 0 && !chat.isBusy ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface/60 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg border border-accent/25 bg-accent/12 text-accent">
                  <Sparkles size={14} />
                </span>
                <h2 className="text-sm font-semibold text-ink">Asisten Desain PCB</h2>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                Jelaskan rangkaian yang kamu mau. AI akan menulis kode tscircuit dan preview langsung diperbarui.
              </p>
              <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-line/80 bg-panel/70 p-2.5 text-xs leading-relaxed text-muted">
                <Paperclip size={13} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  Bisa juga dari referensi: lampirkan gambar skematik, foto board, datasheet PDF, netlist atau file KiCad (klik klip, seret file ke sini, atau tempel screenshot), lalu minta "buatkan PCB dari ini".
                </span>
              </p>
            </div>

            {connectionProblem && (
              <div className="flex items-start gap-2.5 rounded-xl border border-danger/35 bg-danger/10 p-3 text-xs leading-relaxed text-danger">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <p>
                  {connectionProblem}{" "}
                  <button type="button" className="font-semibold underline underline-offset-2 hover:brightness-110" onClick={onOpenSettings}>
                    Buka Pengaturan
                  </button>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Contoh permintaan</p>
              <ul className="space-y-1.5">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <li key={prompt}>
                    <button
                      type="button"
                      className="group flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface/40 px-3 py-2.5 text-left text-xs leading-relaxed text-ink transition hover:border-accent/40 hover:bg-raised"
                      onClick={() => setDraft(prompt)}
                    >
                      <span>{prompt}</span>
                      <ArrowUpRight size={14} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <ul className="space-y-5">
            {chat.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                projectId={projectId}
                canUndo={message.id === lastAppliedId && !chat.isBusy}
                onUndo={(m) => void chat.undo(m)}
                onRunCommand={onRunCommand}
              />
            ))}
            {chat.isBusy && (
              <PendingReply
                streamingText={chat.streamingText}
                reasoningText={chat.reasoningText}
                busySince={chat.busySince}
                toolSteps={chat.toolSteps}
                writingTool={chat.writingTool}
              />
            )}
          </ul>
        )}
      </div>

      {chat.autoFixRemaining > 0 && chat.isBusy && (
        <div className="shrink-0 border-t border-warn/25 bg-warn/8 px-4 py-1.5 text-xs font-medium text-warn">
          Memperbaiki error build otomatis…
        </div>
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
