import { Hammer, History, Maximize2, Minimize2, Plus, TerminalSquare, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { api } from "../../lib/api"
import { useLiveData } from "../../lib/live-data"
import { IconButton } from "../ui"
import { TerminalView, type TerminalHandle } from "./TerminalView"

interface TerminalPanelProps {
  projectId: string
  projectName: string
  theme: "dark" | "light"
  /** A proposed command to type into the active shell (not executed: the user presses Enter). */
  command: { text: string; nonce: number } | null
  /** Called once the command was typed, so it is never typed again (e.g. when the panel reopens). */
  onCommandDelivered: () => void
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

export function TerminalPanel({ projectId, projectName, theme, command, onCommandDelivered, onClose, onSettled }: TerminalPanelProps) {
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

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current)
    },
    [],
  )

  // Run a proposed command once a shell exists (the view queues it until its socket opens).
  const lastNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!command || command.nonce === lastNonce.current || activeKey === null) return
    const handle = handles.current.get(activeKey)
    if (!handle) return
    lastNonce.current = command.nonce
    handle.run(command.text, false)
    onCommandDelivered()
  }, [command, activeKey, sessions, onCommandDelivered])

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
    <section
      aria-label="Terminal"
      className="flex shrink-0 flex-col border-t border-line bg-panel shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.45)]"
      style={{ height: maximized ? "70vh" : height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Ubah tinggi terminal"
        onPointerDown={startResize}
        className="flex h-1.5 cursor-row-resize items-center justify-center transition-colors hover:bg-accent/25"
      >
        <span className="h-0.5 w-10 rounded-full bg-line" />
      </div>
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface/40 px-2.5">
        <TerminalSquare size={14} className="shrink-0 text-accent" />
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Sesi terminal">
          {sessions.map((session, index) => (
            <div
              key={session.key}
              className={`group flex shrink-0 items-center rounded-md border text-xs transition ${
                session.key === activeKey
                  ? "border-line bg-raised font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <button type="button" role="tab" aria-selected={session.key === activeKey} className="px-2 py-1" onClick={() => setActiveKey(session.key)}>
                {index + 1}. {session.label}
                {session.ended && " (selesai)"}
              </button>
              <button
                type="button"
                aria-label={`Tutup terminal ${index + 1}`}
                className="pr-1.5 opacity-60 transition hover:text-danger hover:opacity-100"
                onClick={() => closeSession(session.key)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {QUICK_COMMANDS.map(({ label, command, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled={!active || active.ended}
              onClick={() => activeKey !== null && handles.current.get(activeKey)?.run(command)}
              className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface/70 px-2 py-1 font-mono text-[11px] text-muted transition hover:border-accent/40 hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              <Icon size={11} className="text-accent" />
              {label}
            </button>
          ))}
        </div>
        <span className="h-4 w-px bg-line" aria-hidden="true" />
        <IconButton label="Terminal baru" className="size-7 rounded-md" disabled={!status.data?.enabled} onClick={openSession}>
          <Plus size={14} />
        </IconButton>
        <IconButton label={maximized ? "Kecilkan terminal" : "Besarkan terminal"} className="size-7 rounded-md" onClick={() => setMaximized((v) => !v)}>
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </IconButton>
        <IconButton label="Tutup panel terminal" className="size-7 rounded-md" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 bg-surface">
        {status.error && <p className="p-3 text-sm text-danger">{status.error.message}</p>}
        {status.data && !status.data.enabled && (
          <p className="p-3 text-sm text-muted">
            Terminal dimatikan di server. Set <code className="rounded bg-raised px-1 py-0.5 font-mono text-xs">ENABLE_TERMINAL=true</code> di .env lalu restart (pastikan login dengan password aktif).
          </p>
        )}
        {sessions.map((session) => (
          <TerminalView
            key={session.key}
            projectId={session.projectId}
            theme={theme}
            visible={session.key === activeKey}
            handleRef={(handle) => {
              if (!handle) return
              const isNew = !handles.current.has(session.key)
              handles.current.set(session.key, handle)
              // The first shell may appear after the command was requested.
              if (isNew && command && command.nonce !== lastNonce.current && session.key === activeKey) {
                lastNonce.current = command.nonce
                handle.run(command.text, false)
                onCommandDelivered()
              }
            }}
            onOutput={handleOutput}
            onExit={() => setSessions((current) => current.map((s) => (s.key === session.key ? { ...s, ended: true } : s)))}
          />
        ))}
      </div>
    </section>
  )
}
