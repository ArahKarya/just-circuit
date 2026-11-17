import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { toTurns } from "../lib/chat-history"
import { describeLibrary } from "../lib/library"
import { notifyChange, useLiveData } from "../lib/live-data"
import { streamChat } from "../lib/llm-client"
import { appendMemory, extractMemoryNotes } from "../lib/memory"
import { filesKey, withFiles } from "../lib/project-ops"
import { chatConnection, connectionProblem, DEFAULT_AI_SETTINGS, DEFAULT_HISTORY_LIMIT, temperatureFor } from "../lib/providers"
import { changesFromReply } from "../lib/reply-changes"
import { libraryRepo, memoryRepo, messagesRepo, projectsRepo, settingsRepo, TOPICS } from "../lib/repo"
import { buildAgentSystemPrompt, buildEditFailureRequest, buildFixRequest, buildSystemPrompt } from "../lib/system-prompt"
import type { DesignIssue } from "../lib/drc"
import type { AttachmentRef, ChatMessage, Project, RunStatus, ToolStep } from "../lib/types"
import type { ChatTurn } from "../lib/llm-client"

const REASONING_TAIL = 600
const NO_MESSAGES: ChatMessage[] = []
const VERSION_SUMMARY_CHARS = 72

/** Version message for an AI change: the request it answered, shortened to one line. */
function versionMessage(request: string, isAutoFix: boolean): string {
  if (isAutoFix) return "AI: perbaiki error"
  const line = request.trim().split("\n")[0].replace(/\s+/g, " ")
  return `AI: ${line.length > VERSION_SUMMARY_CHARS ? `${line.slice(0, VERSION_SUMMARY_CHARS)}…` : line}`
}

interface PendingEditFix {
  projectId: string
  failures: string[]
}

interface UseChatOptions {
  project: Project | undefined
  runStatus: RunStatus
  /** Applies AI changes to the open project; the message records a version. */
  onApplyProject: (project: Project, commitMessage?: string) => Promise<void>
  /** Saves pending typing (agent mode reads files from the server). */
  flush: () => Promise<void>
  /** Problems of the last preview build, sent to the AI with each request. */
  getProblems?: () => readonly DesignIssue[]
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
  /** Agent mode: tools used so far in the current answer. */
  toolSteps: LiveToolStep[]
  /** Agent mode: a tool input the model is still writing (a big edit), with its size so far. */
  writingTool: { name: string; chars: number } | null
  send: (text: string, attachments?: AttachmentRef[]) => Promise<void>
  stop: () => void
  undo: (message: ChatMessage) => Promise<void>
  clear: () => Promise<void>
}

/**
 * Stores notes the AI asked to remember; failures are reported but never block the reply.
 * When the AI read outside text (part catalogs, attached files) that text could plant notes, so
 * nothing is stored automatically.
 */
async function saveMemoryNotes(projectId: string, reply: string, projectMemory: string, globalMemory: string, readOutsideText: boolean): Promise<void> {
  const notes = extractMemoryNotes(reply)
  if (readOutsideText) {
    if (notes.project.length + notes.global.length > 0) {
      toast("Catatan memori dari jawaban ini tidak disimpan otomatis (AI membaca lampiran atau data part dari luar). Salin manual kalau perlu.", { icon: "ℹ️" })
    }
    return
  }
  try {
    const nextProject = appendMemory(projectMemory, notes.project)
    const nextGlobal = appendMemory(globalMemory, notes.global)
    if (nextProject !== null) await memoryRepo.writeProject(projectId, nextProject)
    if (nextGlobal !== null) await memoryRepo.writeGlobal(nextGlobal)
    const saved = (nextProject !== null ? notes.project.length : 0) + (nextGlobal !== null ? notes.global.length : 0)
    if (saved > 0) toast.success(`AI mencatat ${saved} hal ke memori`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Gagal menyimpan memori")
  }
}

function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Dihentikan."
  return error instanceof Error ? error.message : "Terjadi kesalahan yang tidak diketahui"
}

export interface LiveToolStep extends ToolStep {
  id: string
}

const DEFAULT_AGENT_STEPS = 12

/** Tells the open editor to reload files the agent changed on the server. */
function reloadAfterAgent(projectId: string, changed: readonly string[]): void {
  if (changed.length > 0) notifyChange(TOPICS.project(projectId), TOPICS.versions(projectId), TOPICS.projects)
}

export function useChat({ project, runStatus, onApplyProject, flush, getProblems }: UseChatOptions): ChatState {
  const projectId = project?.id
  const messages = useLiveData(projectId ? () => messagesRepo.list(projectId) : null, projectId ? [TOPICS.messages(projectId)] : []).data ?? NO_MESSAGES
  const [streamingText, setStreamingText] = useState("")
  const [reasoningText, setReasoningText] = useState("")
  const [busySince, setBusySince] = useState<number | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [autoFixRemaining, setAutoFixRemaining] = useState(0)
  const [toolSteps, setToolSteps] = useState<LiveToolStep[]>([])
  const [writingTool, setWritingTool] = useState<{ name: string; chars: number } | null>(null)
  /** Edits the AI sent that did not match the files; handed back to it like build errors. */
  const [editFailures, setEditFailures] = useState<PendingEditFix | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const expectedRevision = useRef<string | null>(null)
  const busyRef = useRef(false)
  const projectRef = useRef(project)
  projectRef.current = project

  /** Saves AI changes to the project they were requested for, even if the user switched away. */
  const applyToProject = useCallback(
    async (projectIdToUpdate: string, changes: Record<string, string>, commitMessage: string): Promise<{ previous: Project; next: Project; isActive: boolean } | null> => {
      const active = projectRef.current
      const isActive = active?.id === projectIdToUpdate
      const previous = isActive ? active : await projectsRepo.get(projectIdToUpdate).catch(() => undefined)
      if (!previous) return null
      const next = withFiles(previous, changes)
      if (isActive) await onApplyProject(next, commitMessage)
      else await projectsRepo.save(next, commitMessage)
      return { previous, next, isActive }
    },
    [onApplyProject],
  )

  const run = useCallback(
    async (text: string, isAutoFix: boolean, attachments: readonly AttachmentRef[] = []): Promise<boolean> => {
      const current = projectRef.current
      if (!current || busyRef.current) return false
      busyRef.current = true
      setIsBusy(true)
      setBusySince(Date.now())
      setStreamingText("")
      setReasoningText("")
      setToolSteps([])
      const addMessage = (message: Omit<ChatMessage, "id" | "projectId" | "createdAt">) =>
        messagesRepo.add({ id: crypto.randomUUID(), projectId: current.id, createdAt: Date.now(), ...message })
      try {
        // Read settings and history from the database so nothing saved a moment ago is missed.
        const [stored, history, projectMemory, globalMemory, library] = await Promise.all([
          settingsRepo.read(),
          messagesRepo.list(current.id),
          memoryRepo.readProject(current.id).catch(() => ""),
          memoryRepo.readGlobal().catch(() => ""),
          libraryRepo.list().catch(() => []),
        ])
        const settings = { ...DEFAULT_AI_SETTINGS, ...stored }
        await addMessage({ role: "user", content: text, ...(attachments.length > 0 ? { attachments: [...attachments] } : {}) })
        const connection = chatConnection(settings, current.settings, isAutoFix)
        const problem = connectionProblem(connection)
        if (problem || !connection) {
          await addMessage({ role: "assistant", content: problem ?? "", isError: true })
          return true
        }
        if (!isAutoFix) setAutoFixRemaining(settings.autoFixAttempts)

        const controller = new AbortController()
        abortRef.current = controller
        const scope = { schematicDisabled: current.settings?.schematicDisabled, routingDisabled: current.settings?.routingDisabled }
        const promptContext = { projectRules: current.settings?.aiRules, projectMemory, globalMemory, library: describeLibrary(library), problems: getProblems?.(), scope }
        const currentTurn: ChatTurn = { role: "user", content: text, ...(attachments.length > 0 ? { attachments: attachments.map((a) => a.id) } : {}) }
        const turns = [...toTurns(history, settings.historyLimit ?? DEFAULT_HISTORY_LIMIT), currentTurn]
        // Once a chat holds attachments, any later reply may echo them: memory is never saved automatically there.
        const readsAttachments = attachments.length > 0 || history.some((m) => (m.attachments?.length ?? 0) > 0)

        if (settings.agentMode) {
          await flush()
          const steps: LiveToolStep[] = []
          const updateSteps = (next: LiveToolStep[]) => {
            steps.splice(0, steps.length, ...next)
            setToolSteps([...next])
          }
          let changed: string[] = []
          try {
            const result = await streamChat({
              connection,
              system: buildAgentSystemPrompt(current.files, current.entrypoint, promptContext),
              messages: turns,
              projectId: current.id,
              temperature: temperatureFor(connection, settings.temperature),
              maxOutputTokens: settings.maxOutputTokens,
              signal: controller.signal,
              agent: {
                projectId: current.id,
                maxSteps: settings.agentMaxSteps ?? DEFAULT_AGENT_STEPS,
                versionMessage: versionMessage(text, false).replace(/^AI:/, "AI (agen):"),
                ...scope,
              },
              onText: (delta) => setStreamingText((prev) => prev + delta),
              onReasoning: (delta) => setReasoningText((prev) => (prev + delta).slice(-REASONING_TAIL)),
              onTool: (event) => {
                setWritingTool(null)
                updateSteps([...steps, { id: event.id, name: event.name, detail: event.detail }])
              },
              onToolInput: (event) => setWritingTool({ name: event.name, chars: event.chars }),
              onToolResult: (event) => updateSteps(steps.map((step) => (step.id === event.id ? { ...step, ok: event.ok, result: event.detail } : step))),
            })
            changed = result.changedFiles
            await saveMemoryNotes(current.id, result.text, projectMemory, globalMemory, readsAttachments || steps.some((step) => step.name === "search_jlcpcb"))
            const content = result.truncated ? `${result.text}\n\n(Jawaban terpotong karena batas token.)` : result.text
            await addMessage({
              role: "assistant",
              content: content || "(selesai tanpa ringkasan)",
              toolSteps: steps.map(({ id: _id, ...step }) => step),
              ...(changed.length > 0 ? { appliedFiles: changed, previousFiles: current.files } : {}),
            })
          } catch (error) {
            changed = (error as { changedFiles?: string[] }).changedFiles ?? []
            throw error
          } finally {
            reloadAfterAgent(current.id, changed)
          }
          // Let the preview check the agent's result; build errors go back to the agent.
          if (changed.length > 0) {
            const fresh = await projectsRepo.get(current.id).catch(() => null)
            if (fresh && projectRef.current?.id === current.id) {
              expectedRevision.current = filesKey(fresh.files)
              if (!isAutoFix) setAutoFixRemaining(settings.autoFixAttempts)
            }
          }
          return true
        }

        const result = await streamChat({
          connection,
          system: buildSystemPrompt(current.files, current.entrypoint, promptContext),
          messages: turns,
          projectId: current.id,
          temperature: temperatureFor(connection, settings.temperature),
          maxOutputTokens: settings.maxOutputTokens,
          signal: controller.signal,
          onText: (delta) => setStreamingText((prev) => prev + delta),
          onReasoning: (delta) => setReasoningText((prev) => (prev + delta).slice(-REASONING_TAIL)),
        })
        const content = result.truncated
          ? `${result.text}\n\n(Jawaban terpotong karena batas token. Naikkan "Maks token jawaban" di Pengaturan.)`
          : result.text
        await saveMemoryNotes(current.id, result.text, projectMemory, globalMemory, readsAttachments)
        const { changes, failures } = changesFromReply(result.text, current.files, current.entrypoint)
        const paths = Object.keys(changes)
        const note = failures.length > 0 ? `\n\n(Edit gagal diterapkan:\n${failures.map((f) => `- ${f}`).join("\n")})` : ""
        const applied = paths.length > 0 ? await applyToProject(current.id, changes, versionMessage(text, isAutoFix)) : null
        if (failures.length > 0) setEditFailures({ projectId: current.id, failures })
        if (!applied) {
          if (failures.length === 0) setAutoFixRemaining(0)
          await addMessage({ role: "assistant", content: content + note })
          return true
        }
        const changed = filesKey(applied.next.files) !== filesKey(applied.previous.files)
        // Failed edits are fixed first; the build is checked on the reply after that.
        if (applied.isActive && changed && failures.length === 0) expectedRevision.current = filesKey(applied.next.files)
        else if (failures.length === 0) setAutoFixRemaining(0)
        await addMessage({ role: "assistant", content: content + note, appliedFiles: paths, previousFiles: applied.previous.files })
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
        setToolSteps([])
        setWritingTool(null)
      }
      return true
    },
    [applyToProject, getProblems],
  )

  const send = useCallback(
    async (text: string, attachments: AttachmentRef[] = []) => {
      await run(text, false, attachments)
    },
    [run],
  )

  // When the AI's edits don't match the files, ask it to resend them (shares the auto-fix budget).
  useEffect(() => {
    if (isBusy || !editFailures) return
    const pending = editFailures
    setEditFailures(null)
    // Never send the follow-up into another project's chat.
    if (autoFixRemaining <= 0 || projectRef.current?.id !== pending.projectId) return
    void run(buildEditFailureRequest(pending.failures), true).then((started) => {
      if (started) setAutoFixRemaining((n) => n - 1)
      else setEditFailures(pending) // the user sent a message at the same moment; retry once idle
    })
  }, [editFailures, isBusy, autoFixRemaining, run])

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
    setEditFailures(null)
    setAutoFixRemaining(0)
  }, [])

  const undo = useCallback(
    async (message: ChatMessage) => {
      const current = projectRef.current
      if (!current || !message.previousFiles || message.projectId !== current.id) return
      setAutoFixRemaining(0)
      expectedRevision.current = null
      await onApplyProject({ ...current, files: message.previousFiles, updatedAt: Date.now() }, "Batalkan perubahan AI")
      await messagesRepo.update(current.id, message.id, { previousFiles: null, appliedFiles: [] })
    },
    [onApplyProject],
  )

  const clear = useCallback(async () => {
    if (!projectId) return
    await messagesRepo.clear(projectId)
  }, [projectId])

  return { messages, streamingText, reasoningText, busySince, isBusy, autoFixRemaining, toolSteps, writingTool, send, stop, undo, clear }
}
