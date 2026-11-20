import type { ManualEditEvent } from "@tscircuit/core"
import { PcbViewerWithContainerHeight } from "@tscircuit/runframe/runner"
import { Check, Move } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { Button } from "./ui"

interface LayoutEditorProps {
  /** Circuit as rendered when the editor opened; kept fixed while editing. */
  circuitJson: unknown[]
  /** Called once for every drag that finished. */
  onMove: (event: ManualEditEvent, circuitJson: unknown[]) => void
  onDone: () => void
}

const EDIT_MODE_STATE = { in_edit_mode: true, in_move_footprint_mode: true }

/**
 * Full-size PCB viewer in "move components" mode. runframe's own PCB tab has
 * no way to switch the viewer into this mode, so Just Circuit opens its own.
 */
export function LayoutEditor({ circuitJson, onMove, onDone }: LayoutEditorProps) {
  const [snapshot] = useState(circuitJson)
  const [moveCount, setMoveCount] = useState(0)
  const handled = useRef(new Set<string>())

  // The viewer reports the whole event list on every change; forward each finished drag once.
  const handleChange = useCallback(
    (events: ManualEditEvent[]) => {
      for (const event of events) {
        const id = event.edit_event_id
        if (event.in_progress || !id || handled.current.has(id)) continue
        handled.current.add(id)
        setMoveCount((count) => count + 1)
        onMove(event, snapshot)
      }
    },
    [onMove, snapshot],
  )

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black">
      <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-panel px-4 py-2 text-sm text-ink shadow-md">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Move size={15} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="truncate font-medium">Mode atur posisi: seret komponen di PCB.</span>
          {moveCount > 0 && (
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent tabular-nums">
              {moveCount} perpindahan tersimpan
            </span>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={onDone}>
          <Check size={14} />
          Selesai
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <PcbViewerWithContainerHeight
          circuitJson={snapshot}
          allowEditing
          initialState={EDIT_MODE_STATE}
          onEditEventsChanged={handleChange}
          containerClassName="h-full w-full"
        />
      </div>
    </div>
  )
}
