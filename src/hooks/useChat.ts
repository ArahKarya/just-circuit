import { useLiveQuery } from "dexie-react-hooks"
import { useCallback, useEffect, useRef, useState } from "react"
import { db, readAiSettings } from "../lib/db"
import { extractFiles } from "../lib/extract-code"
import { streamChat, type ChatTurn } from "../lib/llm-client"
import { filesKey, withFiles } from "../lib/project-ops"
import { activeConnection, connectionProblem, DEFAULT_AI_SETTINGS } from "../lib/providers"
import { buildFixRequest, buildSystemPrompt } from "../lib/system-prompt"
import type { ChatMessage, Project, RunStatus } from "../lib/types"

const HISTORY_LIMIT = 16
const REASONING_TAIL = 600

interface UseChatOptions {
  project: Project | undefined
  runStatus: RunStatus
  onApplyProject: (project: Project) => Promise<void>
}

export interface ChatState {
  messages: ChatMessage[]
  streamingText: string
  /** Tail of the model's current thinking, if it streams any. */
  reasoningText: string
  /** When the current request started (ms), for an elapsed-time display. */
  busySince: number | null
  isBusy: boolean
  autoFixRemaining: number
  send: (text: string) => Promise<void>
  stop: () => void
  undo: (message: ChatMessage) => Promise<void>
  clear: () => Promise<void>
}

function toTurns(messages: readonly ChatMessage[]): ChatTurn[] {
  return messages
    .filter((m) => !m.isError)
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }))
}

function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Dihentikan."
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui"
}

export function useChat({ project, runStatus, onApplyProject }: UseChatOptions): ChatState {
  const projectId = project?.id
  const messages =
    useLiveQuery(
      () => (projectId ? db.messages.where("projectId").equals(projectId).sortBy("createdAt") : []),
      [projectId],
    ) ?? []
  const [streamingText, setStreamingText] = useState("")
  const [reasoningText, setReasoningText] = useState("")
  const [busySince, setBusySince] = useState<number | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [autoFixRemaining, setAutoFixRemaining] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const expectedRevision = useRef<string | null>(null)
  const busyRef = useRef(false)
  const projectRef = useRef(project)
  projectRef.current = project

  /** Saves AI changes to the project they were requested for, even if the user switched away. */
  const applyToProject = useCallback(
    async (projectIdToUpdate: string, changes: Record<string, string>): Promise<{ previous: Project; next: Project; isActive: boolean } | null> => {
      const active = projectRef.current
      const isActive = active?.id === projectIdToUpdate
      const previous = isActive ? active : await db.projects.get(projectIdToUpdate)
      if (!previous) return null
      const next = withFiles(previous, changes)
      if (isActive) await onApplyProject(next)
      else await db.projects.put(next)
      return { previous, next, isActive }
    },
    [onApplyProject],
  )

  const run = useCallback(
    async (text: string, isAutoFix: boolean): Promise<boolean> => {
      const current = projectRef.current
      if (!current || busyRef.current) return false
      busyRef.current = true
      setIsBusy(true)
      setBusySince(Date.now())
      setStreamingText("")
      setReasoningText("")
      const addMessage = (message: Omit<ChatMessage, "id" | "projectId" | "createdAt">) =>
        db.messages.add({ id: crypto.randomUUID(), projectId: current.id, createdAt: Date.now(), ...message })
      try {
        // Read settings and history from the database so nothing saved a moment ago is missed.
        const settings = { ...DEFAULT_AI_SETTINGS, ...(await readAiSettings()) }
        const history = await db.messages.where("projectId").equals(current.id).sortBy("createdAt")
        await addMessage({ role: "user", content: text })
        const connection = activeConnection(settings)
        const problem = connectionProblem(connection)
        if (problem || !connection) {
          await addMessage({ role: "assistant", content: problem ?? "", isError: true })
          return true
        }
        if (!isAutoFix) setAutoFixRemaining(settings.autoFixAttempts)

        const controller = new AbortController()
        abortRef.current = controller
        const result = await streamChat({
          connection,
          system: buildSystemPrompt(current.files, current.entrypoint),
          messages: [...toTurns(history), { role: "user", content: text }],
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
          signal: controller.signal,
          onText: (delta) => setStreamingText((prev) => prev + delta),
          onReasoning: (delta) => setReasoningText((prev) => (prev + delta).slice(-REASONING_TAIL)),
        })
        const content = result.truncated
          ? `${result.text}\n\n(Jawaban terpotong karena batas token. Naikkan "Maks token jawaban" di Pengaturan.)`
          : result.text
        const files = extractFiles(result.text, current.entrypoint)
        const applied = files.length > 0 ? await applyToProject(current.id, Object.fromEntries(files.map((f) => [f.path, f.content]))) : null
        if (!applied) {
          setAutoFixRemaining(0)
          await addMessage({ role: "assistant", content })
          return true
        }
        const changed = filesKey(applied.next.files) !== filesKey(applied.previous.files)
        if (applied.isActive && changed) expectedRevision.current = filesKey(applied.next.files)
        else setAutoFixRemaining(0)
        await addMessage({ role: "assistant", content, appliedFiles: files.map((f) => f.path), previousFiles: applied.previous.files })
      } catch (error) {
        setAutoFixRemaining(0)
        await addMessage({ role: "assistant", content: errorText(error), isError: true })
      } finally {
        abortRef.current = null
        busyRef.current = false
        setIsBusy(false)
        setBusySince(null)
        setStreamingText("")
        setReasoningText("")
      }
      return true
    },
    [applyToProject],
  )

  const send = useCallback(
    async (text: string) => {
      await run(text, false)
    },
    [run],
  )

  // When the AI's code fails to build, hand the errors back to it a limited number of times.
  useEffect(() => {
    if (isBusy || autoFixRemaining <= 0) return
    if (runStatus.revision !== expectedRevision.current) return
    if (runStatus.state === "ok") {
      expectedRevision.current = null
      setAutoFixRemaining(0)
      return
    }
    if (runStatus.state !== "error" || runStatus.errors.length === 0) return
    expectedRevision.current = null
    void run(buildFixRequest(runStatus.errors), true).then((started) => {
      setAutoFixRemaining((n) => (started ? n - 1 : 0))
    })
  }, [runStatus, isBusy, autoFixRemaining, run])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    expectedRevision.current = null
    setAutoFixRemaining(0)
  }, [])

  const undo = useCallback(
    async (message: ChatMessage) => {
      const current = projectRef.current
      if (!current || !message.previousFiles || message.projectId !== current.id) return
      setAutoFixRemaining(0)
      expectedRevision.current = null
      await onApplyProject({ ...current, files: message.previousFiles, updatedAt: Date.now() })
      await db.messages.update(message.id, { previousFiles: undefined, appliedFiles: [] })
    },
    [onApplyProject],
  )

  const clear = useCallback(async () => {
    if (!projectId) return
    await db.messages.where("projectId").equals(projectId).delete()
  }, [projectId])

  return { messages, streamingText, reasoningText, busySince, isBusy, autoFixRemaining, send, stop, undo, clear }
}
