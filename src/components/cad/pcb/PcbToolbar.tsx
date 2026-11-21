import type { PcbBoardView } from "../../../lib/circuit-extract"
import type { ComponentSummary } from "../../../lib/tsx-ast"
import { PcbEditActions } from "./PcbEditActions"
import { PcbLayerControls } from "./PcbLayerControls"
import { PcbToolPalette } from "./PcbToolPalette"
import { PcbViewControls } from "./PcbViewControls"
import type { PcbComponentActions } from "./usePcbComponentActions"
import type { PcbDrawing } from "./usePcbDrawing"
import type { DiffPairForm, ZoneManager } from "./usePcbRules"
import type { PcbSelection } from "./usePcbSelection"
import type { PcbToolSettings, PcbViewOptions } from "./usePcbSettings"
import type { PcbViewport } from "./usePcbViewport"

interface PcbToolbarProps {
  board: PcbBoardView
  settings: PcbToolSettings
  view: PcbViewOptions
  drawing: PcbDrawing
  selection: PcbSelection
  actions: PcbComponentActions
  viewport: PcbViewport
  zones: ZoneManager
  diffPair: DiffPairForm
  pourCount: number
  selectedSummary: ComponentSummary | null
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onDone: () => void
}

/** KiCad Pcbnew-style primary toolbar. */
export function PcbToolbar(props: PcbToolbarProps) {
  const { board, settings, view, drawing, selection, actions, viewport, zones, diffPair, pourCount } = props
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-xs">
      <span className="font-semibold text-ink">PCB CAD</span>
      <span className="h-4 w-px bg-line" />
      <PcbToolPalette settings={settings} drawing={drawing} />
      <PcbLayerControls settings={settings} view={view} zones={zones} diffPair={diffPair} pourCount={pourCount} />
      <PcbEditActions
        selection={selection}
        actions={actions}
        selectedSummary={props.selectedSummary}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
      />
      <PcbViewControls board={board} cursorMm={drawing.cursorMm} viewport={viewport} onApplyBoardSize={actions.applyBoardSize} onDone={props.onDone} />
    </div>
  )
}
