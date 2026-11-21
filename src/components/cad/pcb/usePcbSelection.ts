import { useCallback, useEffect, useMemo, useState } from "react"

interface UsePcbSelectionOptions {
  selectedComponent?: string | null
  onSelectComponent?: (name: string | null) => void
  liveNames: readonly string[]
}

/** Component multi-selection plus the selected manual trace/via and the highlighted net. */
export function usePcbSelection({ selectedComponent, onSelectComponent, liveNames }: UsePcbSelectionOptions) {
  const [rawSelectedNames, setSelectedNames] = useState<string[]>(() => (selectedComponent ? [selectedComponent] : []))
  // Undo, AI edits and deletes can remove parts behind our back: only keep names that still exist.
  const selectedNames = useMemo(() => {
    const live = new Set(liveNames)
    return rawSelectedNames.filter((n) => live.has(n))
  }, [rawSelectedNames, liveNames])
  const [selectedTraceIdx, setSelectedTraceIdx] = useState<number | null>(null)
  const [selectedViaIdx, setSelectedViaIdx] = useState<number | null>(null)
  const [highlightedNet, setHighlightedNet] = useState<string | null>(null)

  const selectedName = selectedNames.length === 1 ? selectedNames[0] : null

  useEffect(() => {
    if (!selectedComponent) setSelectedNames([])
    else if (!selectedNames.includes(selectedComponent)) setSelectedNames([selectedComponent])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComponent])

  const setPrimarySelection = useCallback(
    (name: string | null) => {
      setSelectedNames(name ? [name] : [])
      setSelectedTraceIdx(null)
      setSelectedViaIdx(null)
      onSelectComponent?.(name)
    },
    [onSelectComponent],
  )

  /** Alt/Ctrl+click: adds or removes a part without notifying the parent. */
  const toggleComponent = useCallback((name: string) => {
    setSelectedNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
    setSelectedTraceIdx(null)
    setSelectedViaIdx(null)
  }, [])

  const selectTrace = useCallback((idx: number) => {
    setSelectedTraceIdx(idx)
    setSelectedViaIdx(null)
    setSelectedNames([])
  }, [])

  const selectVia = useCallback((idx: number) => {
    setSelectedViaIdx(idx)
    setSelectedTraceIdx(null)
    setSelectedNames([])
  }, [])

  return {
    selectedNames,
    selectedName,
    selectedTraceIdx,
    setSelectedTraceIdx,
    selectedViaIdx,
    setSelectedViaIdx,
    highlightedNet,
    setHighlightedNet,
    setPrimarySelection,
    toggleComponent,
    selectTrace,
    selectVia,
  }
}

export type PcbSelection = ReturnType<typeof usePcbSelection>
