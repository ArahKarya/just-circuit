import { applyEditEventsToManualEditsFile, type ManualEditEvent } from "@tscircuit/core"
import { applyMoveToCode, asPcbMoveEvent, componentNameFor } from "./layout-placement"
import { MANUAL_EDITS_FILE, parseManualEdits, withManualEdits } from "./manual-edits"
import { withFiles } from "./project-ops"
import type { Project } from "./types"

export type LayoutMoveOutcome =
  | { kind: "code"; name: string; path: string }
  | { kind: "manual-edits"; wired: boolean }
  | { kind: "unsupported"; name: string; path: string }

export interface LayoutMoveResult {
  project: Project
  outcome: LayoutMoveOutcome
}

/**
 * Applies one finished drag from the PCB view. Components positioned in code
 * (pcbX/pcbY) get their numbers updated; the rest go to manual-edits.json.
 */
export function applyLayoutMove(project: Project, event: ManualEditEvent, circuitJson: unknown[]): LayoutMoveResult {
  const move = asPcbMoveEvent(event)
  const name = move ? componentNameFor(circuitJson, move.pcb_component_id) : null
  if (move && name) {
    const placement = applyMoveToCode(project.files, name, move)
    if (placement.status === "updated") {
      return { project: withFiles(project, placement.files), outcome: { kind: "code", name, path: placement.path } }
    }
    if (placement.status === "unsupported") {
      return { project, outcome: { kind: "unsupported", name, path: placement.path } }
    }
  }
  const manualEdits = applyEditEventsToManualEditsFile({
    circuitJson,
    editEvents: [event],
    manualEditsFile: parseManualEdits(project.files[MANUAL_EDITS_FILE]),
  })
  const result = withManualEdits(project, manualEdits)
  return { project: result.project, outcome: { kind: "manual-edits", wired: result.wired } }
}
