import { AlignHorizontalJustifyStart, AlignVerticalJustifyStart, Copy, FlipHorizontal2, Redo2, RotateCw, Trash2, Undo2 } from "lucide-react"
import type { ComponentSummary } from "../../../lib/tsx-ast"
import { Button, IconButton } from "../../ui"
import type { PcbComponentActions } from "./usePcbComponentActions"
import type { PcbSelection } from "./usePcbSelection"

interface PcbEditActionsProps {
  selection: PcbSelection
  actions: PcbComponentActions
  selectedSummary: ComponentSummary | null
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** Multi-select alignment, trace/via delete, undo/redo and actions on the single selected part. */
export function PcbEditActions({ selection, actions, selectedSummary, canUndo, canRedo, onUndo, onRedo }: PcbEditActionsProps) {
  const { selectedNames, selectedName, selectedTraceIdx, selectedViaIdx } = selection
  const { alignSelected, deleteSelectedTraceOrVia, handlePatch, handleDuplicate, handleDelete } = actions
  return (
    <>
      {selectedNames.length >= 2 && (
        <div className="flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-0.5">
          <span className="font-mono text-[11px] text-accent">{selectedNames.length} dipilih</span>
          <IconButton label="Ratakan kiri" className="size-6" onClick={() => alignSelected("left")}>
            <AlignHorizontalJustifyStart size={12} />
          </IconButton>
          <IconButton label="Ratakan atas" className="size-6" onClick={() => alignSelected("top")}>
            <AlignVerticalJustifyStart size={12} />
          </IconButton>
          <button type="button" className="rounded px-1 text-[10px] text-ink hover:bg-raised" onClick={() => alignSelected("distX")}>
            Dist X
          </button>
          <button type="button" className="rounded px-1 text-[10px] text-ink hover:bg-raised" onClick={() => alignSelected("distY")}>
            Dist Y
          </button>
        </div>
      )}

      {(selectedTraceIdx !== null || selectedViaIdx !== null) && (
        <Button size="sm" variant="danger" onClick={deleteSelectedTraceOrVia}>
          <Trash2 size={12} /> Hapus {selectedTraceIdx !== null ? "Trace" : "Via"}
        </Button>
      )}

      <span className="h-4 w-px bg-line" />
      <IconButton label="Undo (Ctrl+Z)" className="size-7" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={14} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" className="size-7" disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={14} />
      </IconButton>
      {selectedName && (
        <>
          <IconButton label="Putar 90° (R)" className="size-7" onClick={() => handlePatch(selectedName, { pcbRotation: ((selectedSummary?.pcbRotation ?? 0) + 90) % 360 })}>
            <RotateCw size={14} />
          </IconButton>
          <IconButton label="Balik layer (F)" className="size-7" onClick={() => handlePatch(selectedName, { layer: selectedSummary?.layer === "bottom" ? "top" : "bottom" })}>
            <FlipHorizontal2 size={14} />
          </IconButton>
          <IconButton label="Duplikat komponen" className="size-7" onClick={() => handleDuplicate(selectedName)}>
            <Copy size={13} />
          </IconButton>
          <IconButton label="Hapus komponen (Del)" className="size-7 hover:text-danger" onClick={() => handleDelete(selectedName)}>
            <Trash2 size={14} />
          </IconButton>
        </>
      )}
    </>
  )
}
