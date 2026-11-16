import { Bot, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { stripCodeBlocks } from "../lib/extract-code"

interface PendingReplyProps {
  streamingText: string
  reasoningText: string
  busySince: number | null
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

export function PendingReply({ streamingText, reasoningText, busySince }: PendingReplyProps) {
  const seconds = useElapsedSeconds(busySince)
  const text = displayText(streamingText)
  const phase = streamingText ? "Menulis" : reasoningText ? "Berpikir" : "Menunggu AI"
  const isSilent = !streamingText && !reasoningText

  return (
    <li className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Bot size={14} />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
          <Loader2 size={12} className="animate-spin" />
          {phase}… {seconds} dtk
        </p>
        {reasoningText && !streamingText && (
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs italic leading-relaxed text-muted/70">…{reasoningText.trim()}</p>
        )}
        {text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{text}</p>}
        {isSilent && seconds >= SLOW_HINT_AFTER_S && (
          <p className="text-xs text-warn">
            Belum ada respons. Model besar seperti Opus bisa berpikir beberapa menit tanpa terlihat (ditunggu sampai 5 menit). Kalau tidak sabar, klik stop lalu pakai Sonnet.
          </p>
        )}
      </div>
    </li>
  )
}
