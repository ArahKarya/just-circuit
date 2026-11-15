import { RunFrame } from "@tscircuit/runframe/runner"
import { memo, useCallback, useMemo } from "react"
import { useDebounced } from "../hooks/useDebounced"
import { filesKey } from "../lib/project-ops"
import type { ProjectFiles, RunStatus } from "../lib/types"

interface PreviewPaneProps {
  files: ProjectFiles
  entrypoint: string
  onStatus: (status: RunStatus) => void
}

const PREVIEW_DEBOUNCE_MS = 700

function describeError(error: unknown): string {
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    const message = record.message ?? record.error_message ?? record.error
    if (typeof message === "string") return message
  }
  try {
    return JSON.stringify(error).slice(0, 500)
  } catch {
    return "Error tidak dikenal"
  }
}

function PreviewPaneImpl({ files, entrypoint, onStatus }: PreviewPaneProps) {
  const debouncedFiles = useDebounced(files, PREVIEW_DEBOUNCE_MS)
  const revision = useMemo(() => filesKey(debouncedFiles), [debouncedFiles])
  const fsMap = useMemo(() => ({ ...debouncedFiles }), [debouncedFiles])

  const handleStarted = useCallback(() => onStatus({ state: "running", errors: [], revision }), [onStatus, revision])
  const handleCompleted = useCallback(
    ({ errors, hasExecutionError }: { errors?: unknown[]; hasExecutionError: boolean }) => {
      const messages = (errors ?? []).map(describeError).filter(Boolean)
      const failed = hasExecutionError || messages.length > 0
      onStatus({ state: failed ? "error" : "ok", errors: messages, revision })
    },
    [onStatus, revision],
  )

  return (
    <div className="h-full min-h-0 overflow-hidden bg-white">
      <RunFrame
        fsMap={fsMap}
        mainComponentPath={entrypoint}
        showFileMenu
        showToggleFullScreen
        defaultActiveTab="pcb"
        onRenderStarted={handleStarted}
        onRunCompleted={handleCompleted}
        easyEdaProxyConfig={{ proxyEndpointUrl: "/api/jlc/proxy" }}
      />
    </div>
  )
}

export const PreviewPane = memo(PreviewPaneImpl)
