import { Bot, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { formatBytes } from "../../shared/attachments"
import { stripCodeBlocks } from "../lib/extract-code"
import type { ToolStep } from "../lib/types"
import { ToolSteps } from "./ToolSteps"

interface PendingReplyProps {
  streamingText: string
  reasoningText: string
  busySince: number | null
  toolSteps?: readonly ToolStep[]
  /** A tool input still being written (agent mode). */
  writingTool?: { name: string; chars: number } | null
}

const SLOW_HINT_AFTER_S = 90

/** Hides a code block that is still being written, showing its line count instead. */
function displayText(text: string): string {
  const fences = text.split("```").length - 1
  if (fences % 2 === 0) return stripCodeBlocks(text).trim()
  const lastFence = text.lastIndexOf("```")
  const lines = text.slice(lastFence).split("\n").length - 1
  return `${stripCodeBlocks(text.slice(0, lastFence)).trim()}\n[menulis kode… ${lines} baris]`.trim()
}

function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000))
}

export function PendingReply({ streamingText, reasoningText, busySince, toolSteps = [], writingTool = null }: PendingReplyProps) {
  const seconds = useElapsedSeconds(busySince)
  const text = displayText(streamingText)
  const running = toolSteps.find((step) => step.ok === undefined)
  const phase = writingTool
    ? `Menyiapkan ${writingTool.name} (${formatBytes(writingTool.chars)})`
    : running
      ? "Bekerja"
      : streamingText
        ? "Menulis"
        : reasoningText
          ? "Berpikir"
          : "Menunggu AI"
  const isSilent = !streamingText && !reasoningText && toolSteps.length === 0 && !writingTool

  return (
    <li className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/12 text-accent">
        <Bot size={14} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2.5 py-0.5 text-xs font-medium text-muted tabular-nums" aria-live="polite">
          <Loader2 size={12} className="animate-spin text-accent" />
          {phase}… {seconds} dtk
        </p>
        {toolSteps.length > 0 && <ToolSteps steps={toolSteps} />}
        {reasoningText && !streamingText && (
          <p className="line-clamp-4 whitespace-pre-wrap break-words border-l-2 border-accent/40 pl-2.5 text-xs italic leading-relaxed text-muted/80">
            …{reasoningText.trim()}
          </p>
        )}
        {text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink/90">{text}</p>}
        {isSilent && seconds >= SLOW_HINT_AFTER_S && (
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs leading-relaxed text-warn">
            Belum ada respons. Model besar seperti Opus bisa berpikir beberapa menit tanpa terlihat (ditunggu sampai 5 menit). Kalau tidak sabar, klik stop lalu pakai Sonnet.
          </p>
        )}
      </div>
    </li>
  )
}
