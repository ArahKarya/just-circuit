import { useState } from "react"
import type { CopperLayer, PcbTool } from "./constants"

/** Active tool and its routing/placement options. */
export function usePcbToolSettings() {
  const [tool, setTool] = useState<PcbTool>("select")
  const [gridMm, setGridMm] = useState<number>(0.5)
  const [activeLayer, setActiveLayer] = useState<CopperLayer>("top")
  const [traceWidth, setTraceWidth] = useState<number>(0.25)
  const [traceNet, setTraceNet] = useState("")
  const [miter45, setMiter45] = useState(true)
  const [diagFirst, setDiagFirst] = useState(false)
  const [silkText, setSilkText] = useState("REV 1.0")
  return {
    tool,
    setTool,
    gridMm,
    setGridMm,
    activeLayer,
    setActiveLayer,
    traceWidth,
    setTraceWidth,
    traceNet,
    setTraceNet,
    miter45,
    setMiter45,
    diagFirst,
    setDiagFirst,
    silkText,
    setSilkText,
  }
}

export type PcbToolSettings = ReturnType<typeof usePcbToolSettings>

/** Layer visibility, overlays and the KiCad 9 style selection filter. */
export function usePcbViewOptions() {
  const [showTop, setShowTop] = useState(true)
  const [showBottom, setShowBottom] = useState(true)
  const [showRatsnest, setShowRatsnest] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [filterComp, setFilterComp] = useState(true)
  const [filterTrace, setFilterTrace] = useState(true)
  const [filterVia, setFilterVia] = useState(true)
  return {
    showTop,
    setShowTop,
    showBottom,
    setShowBottom,
    showRatsnest,
    setShowRatsnest,
    showHeatmap,
    setShowHeatmap,
    filterComp,
    setFilterComp,
    filterTrace,
    setFilterTrace,
    filterVia,
    setFilterVia,
  }
}

export type PcbViewOptions = ReturnType<typeof usePcbViewOptions>
