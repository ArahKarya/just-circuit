import type { PcbSelection } from "./usePcbSelection"
import type { PcbViewOptions } from "./usePcbSettings"

interface PcbSelectionFilterProps {
  view: PcbViewOptions
  selection: PcbSelection
}

/** KiCad 9 selection filter overlay (top-left of the canvas) with the highlighted net chip. */
export function PcbSelectionFilter({ view, selection }: PcbSelectionFilterProps) {
  const filters = [
    ["Part", view.filterComp, view.setFilterComp],
    ["Trace", view.filterTrace, view.setFilterTrace],
    ["Via", view.filterVia, view.setFilterVia],
  ] as const
  return (
    <div className="absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-lg border border-line bg-panel/90 px-2 py-1 text-[11px] backdrop-blur-xs">
      <span className="text-muted">Seleksi:</span>
      {filters.map(([label, checked, setChecked]) => (
        <label key={label} className="flex cursor-pointer items-center gap-1 text-ink">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="accent-emerald-500" />
          {label}
        </label>
      ))}
      {selection.highlightedNet && (
        <button
          type="button"
          onClick={() => selection.setHighlightedNet(null)}
          className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] text-warn"
        >
          Net: {selection.highlightedNet} ×
        </button>
      )}
    </div>
  )
}
