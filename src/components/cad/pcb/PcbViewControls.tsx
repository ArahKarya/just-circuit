import { Check, Maximize2, ZoomIn, ZoomOut } from "lucide-react"
import { useEffect, useState } from "react"
import type { PcbBoardView, Point2D } from "../../../lib/circuit-extract"
import { roundMm } from "../../../lib/tsx-ast"
import { Button, IconButton } from "../../ui"
import type { PcbViewport } from "./usePcbViewport"

interface PcbViewControlsProps {
  board: PcbBoardView
  cursorMm: Point2D
  viewport: PcbViewport
  onApplyBoardSize: (width: string, height: string) => void
  onDone: () => void
}

/** Right side of the toolbar: board size, cursor readout, zoom and "Selesai". */
export function PcbViewControls({ board, cursorMm, viewport, onApplyBoardSize, onDone }: PcbViewControlsProps) {
  const [boardW, setBoardW] = useState(() => String(roundMm(board.width)))
  const [boardH, setBoardH] = useState(() => String(roundMm(board.height)))

  useEffect(() => {
    setBoardW(String(roundMm(board.width)))
    setBoardH(String(roundMm(board.height)))
  }, [board.width, board.height])

  const apply = () => onApplyBoardSize(boardW, boardH)

  return (
    <div className="ml-auto flex items-center gap-1">
      <form
        className="hidden items-center gap-1 2xl:flex"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <input aria-label="Lebar board mm" value={boardW} onChange={(e) => setBoardW(e.target.value)} onBlur={apply} className="h-6 w-11 rounded border border-line bg-surface px-1 font-mono text-[11px] text-ink" />
        <span className="text-muted">×</span>
        <input aria-label="Tinggi board mm" value={boardH} onChange={(e) => setBoardH(e.target.value)} onBlur={apply} className="h-6 w-11 rounded border border-line bg-surface px-1 font-mono text-[11px] text-ink" />
        <span className="text-[11px] text-muted">mm</span>
      </form>
      <span className="hidden font-mono text-[11px] text-muted tabular-nums lg:inline">
        {cursorMm.x.toFixed(1)}, {cursorMm.y.toFixed(1)}
      </span>
      <IconButton label="Perbesar" className="size-7" onClick={viewport.zoomIn}>
        <ZoomIn size={14} />
      </IconButton>
      <IconButton label="Perkecil" className="size-7" onClick={viewport.zoomOut}>
        <ZoomOut size={14} />
      </IconButton>
      <IconButton label="Sesuaikan tampilan" className="size-7" onClick={viewport.fitView}>
        <Maximize2 size={13} />
      </IconButton>
      <Button size="sm" variant="primary" onClick={onDone}>
        <Check size={14} /> Selesai
      </Button>
    </div>
  )
}
