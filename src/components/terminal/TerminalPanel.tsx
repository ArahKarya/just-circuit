import { Hammer, History, Maximize2, Minimize2, Plus, TerminalSquare, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useLiveData } from "../../lib/live-data"
import { api } from "../../lib/api"
import { IconButton } from "../ui"
import { TerminalView, type TerminalHandle } from "./TerminalView"

interface TerminalPanelProps {
  projectId: string
  projectName: string
  theme: "dark" | "light"
  onClose: () => void
  /** Called after the shell goes quiet, so the editor can reload files the command changed. */
  onSettled: () => void
}

interface Session {
  key: number
  projectId: string
  label: string
  ended: boolean
}

const SETTLE_MS = 700
const MIN_HEIGHT = 140
const DEFAULT_HEIGHT = 280
const QUICK_COMMANDS = [
  { label: "tsci build", command: "tsci build", icon: Hammer },
  { label: "git log", command: "git log --oneline -15", icon: History },
] as const

export function TerminalPanel({ projectId, projectName, theme, onClose, onSettled }: TerminalPanelProps) {
  const status = useLiveData(() => api.get<{ enabled: boolean }>("/api/terminal/status"), ["terminal-status"])
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeKey, setActiveKey] = useState<number | null>(null)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [maximized, setMaximized] = useState(false)
  const handles = useRef(new Map<number, TerminalHandle>())
  const nextKey = useRef(1)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openSession = useCallback(() => {
    const key = nextKey.current++
    setSessions((current) => [...current, { key, projectId, label: projectName, ended: false }])
    setActiveKey(key)
  }, [projectId, projectName])

  // Open the first shell when the panel appears.
  useEffect(() => {
    if (status.data?.enabled && sessions.length === 0) openSession()
  }, [status.data?.enabled, sessions.length, openSession])

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
  }, [])

  const handleOutput = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(onSettled, SETTLE_MS)
  }, [onSettled])

  const closeSession = (key: number) => {
    handles.current.delete(key)
    setSessions((current) => {
      const next = current.filter((s) => s.key !== key)
      if (activeKey === key) setActiveKey(next.at(-1)?.key ?? null)
      if (next.length === 0) onClose()
      return next
    })
  }

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    const move = (e: PointerEvent) => setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.8, startHeight + startY - e.clientY)))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const active = sessions.find((s) => s.key === activeKey)

  return (
    <section aria-label="Terminal" className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height: maximized ? "70vh" : height }}>
      <div role="separator" aria-orientation="horizontal" aria-label="Ubah tinggi terminal" onPointerDown={startResize} className="h-1 cursor-row-resize hover:bg-accent/40" />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <TerminalSquare size={15} className="text-muted" />
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Sesi terminal">
          {sessions.map((session, index) => (
            <div key={session.key} className={`group flex shrink-0 items-center rounded text-xs ${session.key === activeKey ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
              <button type="button" role="tab" aria-selected={session.key === activeKey} className="px-2 py-1" onClick={() => setActiveKey(session.key)}>
                {index + 1}. {session.label}
                {session.ended && " (selesai)"}
              </button>
              <button type="button" aria-label={`Tutup terminal ${index + 1}`} className="pr-1.5 opacity-60 hover:opacity-100" onClick={() => closeSession(session.key)}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        {QUICK_COMMANDS.map(({ label, command, icon: Icon }) => (
          <button
            key={label}
            type="button"
            disabled={!active || active.ended}
            onClick={() => activeKey !== null && handles.current.get(activeKey)?.run(command)}
            className="flex shrink-0 items-center gap-1 rounded px-2 py-1 font-mono text-xs text-muted hover:bg-raised hover:text-ink disabled:opacity-40"
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
        <IconButton label="Terminal baru" className="size-7" disabled={!status.data?.enabled} onClick={openSession}><Plus size={14} /></IconButton>
        <IconButton label={maximized ? "Kecilkan terminal" : "Besarkan terminal"} className="size-7" onClick={() => setMaximized((v) => !v)}>
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </IconButton>
        <IconButton label="Tutup panel terminal" className="size-7" onClick={onClose}><X size={14} /></IconButton>
      </div>
      <div className="min-h-0 flex-1">
        {status.error && <p className="p-3 text-sm text-danger">{status.error.message}</p>}
        {status.data && !status.data.enabled && (
          <p className="p-3 text-sm text-muted">Terminal dimatikan di server. Set <code className="font-mono">ENABLE_TERMINAL=true</code> di .env lalu restart (pastikan login dengan password aktif).</p>
        )}
        {sessions.map((session) => (
          <TerminalView
            key={session.key}
            projectId={session.projectId}
            theme={theme}
            visible={session.key === activeKey}
            handleRef={(handle) => {
              if (handle) handles.current.set(session.key, handle)
            }}
            onOutput={handleOutput}
            onExit={() => setSessions((current) => current.map((s) => (s.key === session.key ? { ...s, ended: true } : s)))}
          />
        ))}
      </div>
    </section>
  )
}
