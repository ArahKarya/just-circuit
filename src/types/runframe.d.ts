/**
 * Minimal typings for the parts of @tscircuit/runframe that CDS uses.
 * The package's own declarations pull in the full tscircuit core sources,
 * which makes `tsc` run out of memory, so tsconfig maps the import here.
 */
import type { JSX } from "react"
import type { ManualEditEvent } from "@tscircuit/core"

export type TabId = "code" | "pcb" | "schematic" | "assembly" | "cad" | "bom" | "circuit_json" | "errors" | "render_log"

export interface RunCompletedPayload {
  errors?: unknown[]
  hasExecutionError: boolean
}

export interface RunFrameProps {
  fsMap: Record<string, string> | Map<string, string>
  entrypoint?: string
  mainComponentPath?: string
  showFileMenu?: boolean
  showToggleFullScreen?: boolean
  showRunButton?: boolean
  defaultActiveTab?: TabId
  onRenderStarted?: () => void
  onRunCompleted?: (payload: RunCompletedPayload) => void
  onRenderFinished?: (params: { circuitJson: unknown[] }) => void
  onError?: (error: Error) => void
  easyEdaProxyConfig?: { proxyEndpointUrl: string; headers?: Record<string, string> }
  /** Worker script URL; when set, runframe skips fetching "latest" from a CDN. */
  evalWebWorkerBlobUrl?: string
  evalVersion?: string
}

export declare function RunFrame(props: RunFrameProps): JSX.Element

export interface JlcpcbComponentSummary {
  lcscId: number
  manufacturer: string
  partNumber: string
  description: string
  package: string
  price?: number
  stock?: number
  isBasic?: boolean
}

export interface JlcpcbComponentTsxLoadedPayload {
  result: { source: "jlcpcb"; component: JlcpcbComponentSummary }
  tsx: string
}

export interface ImportComponentDialog2Props {
  isOpen: boolean
  onClose: () => void
  jlcpcbProxyApiBase?: string
  jlcpcbProxyRequestHeaders?: Record<string, string>
  onJlcpcbComponentTsxLoaded?: (payload: JlcpcbComponentTsxLoadedPayload) => void | Promise<void>
}

export interface PcbViewerWithContainerHeightProps {
  circuitJson?: unknown[]
  containerClassName?: string
  allowEditing?: boolean
  initialState?: Record<string, unknown>
  editEvents?: ManualEditEvent[]
  onEditEventsChanged?: (events: ManualEditEvent[]) => void
}

export declare function PcbViewerWithContainerHeight(props: PcbViewerWithContainerHeightProps): JSX.Element

export declare function ImportComponentDialog2(props: ImportComponentDialog2Props): JSX.Element
