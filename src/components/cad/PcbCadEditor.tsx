import { useMemo } from "react"
import { extractPcbScene } from "../../lib/circuit-extract"
import { simulateCircuit } from "../../lib/circuit-sim"
import { inspectComponent, listComponents, listManualPcbTraces, listManualVias } from "../../lib/tsx-ast"
import { listCopperPours } from "../../lib/tsx-rules"
import type { Project, ProjectFiles } from "../../lib/types"
import { PcbCanvas } from "./pcb/PcbCanvas"
import { PcbDiffPairBar, PcbZoneBar } from "./pcb/PcbRuleBars"
import { PcbSelectionFilter } from "./pcb/PcbSelectionFilter"
import { PcbStatusHint } from "./pcb/PcbStatusHint"
import { PcbToolbar } from "./pcb/PcbToolbar"
import { usePcbComponentActions } from "./pcb/usePcbComponentActions"
import { usePcbDrawing } from "./pcb/usePcbDrawing"
import { usePcbPointer } from "./pcb/usePcbPointer"
import { useDiffPairForm, useZoneManager } from "./pcb/usePcbRules"
import { usePcbSelection } from "./pcb/usePcbSelection"
import { usePcbToolSettings, usePcbViewOptions } from "./pcb/usePcbSettings"
import { usePcbShortcuts } from "./pcb/usePcbShortcuts"
import { usePcbViewport } from "./pcb/usePcbViewport"
import { PropertyInspector } from "./PropertyInspector"

interface PcbCadEditorProps {
  project: Project
  circuitJson: unknown[]
  selectedComponent?: string | null
  onSelectComponent?: (name: string | null) => void
  lockedComponents?: ReadonlySet<string>
  onToggleLock?: (name: string) => void
  onCommitFiles: (nextFiles: ProjectFiles) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onRevealCode?: (name: string) => void
  onAskAi?: (componentName: string) => void
  onDone: () => void
}

export function PcbCadEditor({
  project,
  circuitJson,
  selectedComponent,
  onSelectComponent,
  lockedComponents,
  onToggleLock,
  onCommitFiles,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRevealCode,
  onAskAi,
  onDone,
}: PcbCadEditorProps) {
  const scene = useMemo(() => extractPcbScene(circuitJson), [circuitJson])
  const codeNames = useMemo(() => listComponents(project.files).map((c) => c.name), [project.files])
  const copperPours = useMemo(() => listCopperPours(project.files), [project.files])
  const manualTraces = useMemo(() => listManualPcbTraces(project.files), [project.files])
  const manualTraceRoutes = useMemo(() => manualTraces.map((trace) => trace.points), [manualTraces])
  const manualVias = useMemo(() => listManualVias(project.files), [project.files])

  const settings = usePcbToolSettings()
  const view = usePcbViewOptions()
  const selection = usePcbSelection({ selectedComponent, onSelectComponent, liveNames: codeNames })
  const viewport = usePcbViewport(scene.board)
  const drawing = usePcbDrawing({ project, settings, onCommitFiles })
  const actions = usePcbComponentActions({ project, scene, codeNames, manualTraces, manualVias, selection, onCommitFiles })
  const zones = useZoneManager({ project, onCommitFiles })
  const diffPair = useDiffPairForm({ project, onCommitFiles })
  const pointer = usePcbPointer({ project, scene, codeNames, settings, view, viewport, drawing, selection, actions, onCommitFiles })
  usePcbShortcuts({ project, settings, drawing, selection, actions, onUndo, onRedo })

  // The IPC-2221 heatmap needs the simulated current, so only simulate while it is shown.
  const heatmapCurrentA = useMemo(() => {
    if (!view.showHeatmap) return 0
    return simulateCircuit(circuitJson).totalCurrentMa / 1000
  }, [view.showHeatmap, circuitJson])

  const { selectedName } = selection
  const selectedSummary = useMemo(() => (selectedName ? inspectComponent(project.files, selectedName) : null), [project.files, selectedName])

  return (
    <div aria-label="Editor PCB CAD" className="absolute inset-0 z-20 flex flex-col bg-[#090c10]">
      <PcbToolbar
        board={scene.board}
        settings={settings}
        view={view}
        drawing={drawing}
        selection={selection}
        actions={actions}
        viewport={viewport}
        zones={zones}
        diffPair={diffPair}
        pourCount={copperPours.length}
        selectedSummary={selectedSummary}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onDone={onDone}
      />
      {zones.open && <PcbZoneBar zones={zones} pours={copperPours} />}
      {diffPair.open && <PcbDiffPairBar form={diffPair} />}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <PcbSelectionFilter view={view} selection={selection} />
          <PcbCanvas
            scene={scene}
            settings={settings}
            view={view}
            viewport={viewport}
            pointer={pointer}
            drawing={drawing}
            selection={selection}
            pours={copperPours}
            manualTraceRoutes={manualTraceRoutes}
            manualVias={manualVias}
            heatmapCurrentA={heatmapCurrentA}
            lockedComponents={lockedComponents}
          />
          <PcbStatusHint settings={settings} drawing={drawing} />
        </div>

        <PropertyInspector
          component={selectedSummary}
          mode="pcb"
          locked={selectedName ? lockedComponents?.has(selectedName) : false}
          onToggleLock={onToggleLock}
          onDuplicate={actions.handleDuplicate}
          onRevealCode={onRevealCode}
          onPatch={actions.handlePatch}
          onDelete={actions.handleDelete}
          onAskAi={onAskAi}
          onClose={() => selection.setPrimarySelection(null)}
        />
      </div>
    </div>
  )
}
