import { RunFrame } from "@tscircuit/runframe/runner"
import { memo, useCallback, useLayoutEffect, useMemo } from "react"
import { ErrorBoundary } from "react-error-boundary"
import { platformConfigFor, type BuildScope } from "../../shared/build-scope"
import { useDebounced } from "../hooks/useDebounced"
import { filesKey } from "../lib/project-ops"
import { classifyRunErrors } from "../lib/run-status"
import type { PreviewTab, ProjectFiles, RunStatus } from "../lib/types"
import { PreviewCrash } from "./PreviewCrash"

/** runframe keeps its evaluator worker on globalThis and reuses it across mounts. */
const runframeGlobal = globalThis as { runFrameWorker?: { kill: () => void } | null }

interface PreviewPaneProps {
  files: ProjectFiles
  entrypoint: string
  onStatus: (status: RunStatus) => void
  /** Latest rendered circuit with the code revision it belongs to (layout editor, problems panel). */
  onCircuitJson: (circuitJson: unknown[], revision: string) => void
  /** Pause after typing before the circuit is rebuilt. */
  debounceMs: number
  defaultTab: PreviewTab
  /** Parts of the build the project skips (schematic, PCB routing). */
  scope?: BuildScope
}

function PreviewPaneImpl({ files, entrypoint, onStatus, onCircuitJson, debounceMs, defaultTab, scope }: PreviewPaneProps) {
  const schematicDisabled = scope?.schematicDisabled ?? false
  const routingDisabled = scope?.routingDisabled ?? false
  const platformConfig = useMemo(() => platformConfigFor({ schematicDisabled, routingDisabled }), [schematicDisabled, routingDisabled])
  // The worker reads platform options only when created, and runframe keeps it across remounts:
  // drop it when the scope changes (this also stops a build stuck in the old, slower scope).
  useLayoutEffect(
    () => () => {
      runframeGlobal.runFrameWorker?.kill()
      runframeGlobal.runFrameWorker = null
    },
    [schematicDisabled, routingDisabled],
  )
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
  const handleRenderFinished = useCallback(({ circuitJson }: { circuitJson: unknown[] }) => onCircuitJson(circuitJson, revision), [onCircuitJson, revision])

  return (
    <div className="h-full min-h-0 overflow-hidden bg-white">
      <ErrorBoundary FallbackComponent={PreviewCrash} resetKeys={[revision]}>
        <RunFrame
          // The evaluator reads platform options once when it starts: a new scope needs a new one.
          key={`${schematicDisabled}-${routingDisabled}`}
          platformConfig={platformConfig}
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
