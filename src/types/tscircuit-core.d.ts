/**
 * Minimal typings for the one @tscircuit/core helper Just Circuit calls directly.
 * The real declarations are huge (see runframe.d.ts), so tsconfig maps the import here.
 */
export type ManualEditEvent = Record<string, unknown> & { edit_event_id?: string; in_progress?: boolean }

export declare function applyEditEventsToManualEditsFile(args: {
  circuitJson: unknown[]
  editEvents: ManualEditEvent[]
  manualEditsFile: Record<string, unknown>
}): Record<string, unknown>
