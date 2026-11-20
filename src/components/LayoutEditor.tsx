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
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-3 py-2 text-sm text-ink">
        <Move size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">
          Mode atur posisi: seret komponen di PCB.
          {moveCount > 0 && <span className="ml-2 text-muted">{moveCount} perpindahan tersimpan</span>}
        </span>
        <Button variant="primary" onClick={onDone}>
          <Check size={15} />
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
