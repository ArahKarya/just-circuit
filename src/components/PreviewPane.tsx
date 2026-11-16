import { RunFrame } from "@tscircuit/runframe/runner"
import { memo, useCallback, useMemo } from "react"
import { ErrorBoundary } from "react-error-boundary"
import { useDebounced } from "../hooks/useDebounced"
import { filesKey } from "../lib/project-ops"
import { classifyRunErrors } from "../lib/run-status"
import type { PreviewTab, ProjectFiles, RunStatus } from "../lib/types"
import { PreviewCrash } from "./PreviewCrash"

interface PreviewPaneProps {
  files: ProjectFiles
  entrypoint: string
  onStatus: (status: RunStatus) => void
  /** Latest rendered circuit, used by the layout editor. */
  onCircuitJson: (circuitJson: unknown[]) => void
  /** Pause after typing before the circuit is rebuilt. */
  debounceMs: number
  defaultTab: PreviewTab
}

function PreviewPaneImpl({ files, entrypoint, onStatus, onCircuitJson, debounceMs, defaultTab }: PreviewPaneProps) {
  const debouncedFiles = useDebounced(files, debounceMs)
  const revision = useMemo(() => filesKey(debouncedFiles), [debouncedFiles])
  const fsMap = useMemo(() => ({ ...debouncedFiles }), [debouncedFiles])

  const handleStarted = useCallback(() => onStatus({ state: "running", errors: [], warnings: [], revision }), [onStatus, revision])
  const handleCompleted = useCallback(
    ({ errors, hasExecutionError }: { errors?: unknown[]; hasExecutionError: boolean }) => {
      const { errors: messages, warnings } = classifyRunErrors(errors ?? [])
      const failed = hasExecutionError || messages.length > 0
      onStatus({ state: failed ? "error" : "ok", errors: messages, warnings, revision })
    },
    [onStatus, revision],
  )
  const handleRenderFinished = useCallback(({ circuitJson }: { circuitJson: unknown[] }) => onCircuitJson(circuitJson), [onCircuitJson])

  return (
    <div className="h-full min-h-0 overflow-hidden bg-white">
      <ErrorBoundary FallbackComponent={PreviewCrash} resetKeys={[revision]}>
        <RunFrame
          fsMap={fsMap}
          mainComponentPath={entrypoint}
          showFileMenu
          showToggleFullScreen
          defaultActiveTab={defaultTab}
          onRenderStarted={handleStarted}
          onRunCompleted={handleCompleted}
          onRenderFinished={handleRenderFinished}
          easyEdaProxyConfig={{ proxyEndpointUrl: "/api/jlc/proxy" }}
          evalWebWorkerBlobUrl={__EVAL_WORKER_URL__}
          evalVersion={__EVAL_VERSION__}
        />
      </ErrorBoundary>
    </div>
  )
}

export const PreviewPane = memo(PreviewPaneImpl)
