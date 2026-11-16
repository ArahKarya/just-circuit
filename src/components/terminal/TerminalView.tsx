import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useImperativeHandle, useRef, type Ref } from "react"

export interface TerminalHandle {
  /** Types a command into the shell; with execute it also presses Enter. */
  run: (command: string, execute?: boolean) => void
  focus: () => void
}

interface TerminalViewProps {
  projectId: string
  theme: "dark" | "light"
  visible: boolean
  handleRef: Ref<TerminalHandle>
  /** Shell printed something (files may have changed). */
  onOutput: () => void
  onExit: () => void
}

const THEMES = {
  dark: { background: "#0f1115", foreground: "#e6e8ec", cursor: "#34d399", selectionBackground: "#34d39955" },
  light: { background: "#ffffff", foreground: "#16181d", cursor: "#059669", selectionBackground: "#05966944" },
} as const

function socketUrl(projectId: string, cols: number, rows: number): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws"
  const query = new URLSearchParams({ project: projectId, cols: String(cols), rows: String(rows) })
  return `${protocol}://${window.location.host}/api/terminal?${query}`
}

/** One xterm.js terminal connected to one shell on the server. */
export function TerminalView({ projectId, theme, visible, handleRef, onOutput, onExit }: TerminalViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const socket = useRef<WebSocket | null>(null)
  /** Commands requested before the socket opened. */
  const queued = useRef<string[]>([])
  const callbacks = useRef({ onOutput, onExit })
  callbacks.current = { onOutput, onExit }

  useImperativeHandle(handleRef, () => ({
    run: (command, execute = true) => {
      const message = JSON.stringify({ t: "i", d: execute ? `${command}\r` : command })
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(message)
      else queued.current.push(message)
      term.current?.focus()
    },
    focus: () => term.current?.focus(),
  }))

  useEffect(() => {
    const element = container.current
    if (!element) return
    const terminal = new Terminal({ fontFamily: "JetBrains Mono, Menlo, monospace", fontSize: 13, cursorBlink: true, scrollback: 5000, theme: THEMES[theme] })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(element)
    fitAddon.fit()
    term.current = terminal
    fit.current = fitAddon

    const ws = new WebSocket(socketUrl(projectId, terminal.cols, terminal.rows))
    socket.current = ws
    ws.onopen = () => {
      // Give the login shell a moment to print its prompt before queued commands.
      setTimeout(() => queued.current.splice(0).forEach((message) => ws.send(message)), 800)
    }
    ws.onmessage = (event) => {
      terminal.write(typeof event.data === "string" ? event.data : "")
      callbacks.current.onOutput()
    }
    ws.onclose = (event) => {
      terminal.write(`\r\n\x1b[2m[sesi selesai${event.reason ? `: ${event.reason}` : ""}]\x1b[0m\r\n`)
      callbacks.current.onExit()
    }
    ws.onerror = () => terminal.write("\r\n\x1b[31mTidak bisa membuka terminal. Cek login dan ENABLE_TERMINAL di server.\x1b[0m\r\n")
    const input = terminal.onData((data) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "i", d: data })))
    const resize = terminal.onResize(({ cols, rows }) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "r", c: cols, r: rows })))
    const observer = new ResizeObserver(() => {
      if (element.offsetParent !== null) fitAddon.fit()
    })
    observer.observe(element)
    terminal.focus()

    return () => {
      observer.disconnect()
      input.dispose()
      resize.dispose()
      ws.onclose = null
      ws.close()
      terminal.dispose()
    }
    // One shell per mounted view; theme changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (term.current) term.current.options.theme = THEMES[theme]
  }, [theme])

  useEffect(() => {
    if (visible) requestAnimationFrame(() => fit.current?.fit())
  }, [visible])

  return <div ref={container} className={`h-full w-full px-2 pt-1 ${visible ? "" : "hidden"}`} data-testid="terminal" />
}
