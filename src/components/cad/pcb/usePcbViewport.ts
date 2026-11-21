import { useCallback, useEffect, useRef, useState, type WheelEvent } from "react"
import type { PcbBoardView, Point2D } from "../../../lib/circuit-extract"
import { clampZoom, fitViewport, screenToBoardMm } from "../../../lib/pcb-cad-geometry"

const WHEEL_ZOOM_IN = 1.12
const WHEEL_ZOOM_OUT = 0.89
const BUTTON_ZOOM_IN = 1.2
const BUTTON_ZOOM_OUT = 0.8

/** Pan/zoom state of the PCB canvas and screen-to-board conversion. */
export function usePcbViewport(board: PcbBoardView) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(14)

  const fitView = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const fit = fitViewport(el.getBoundingClientRect(), board)
    setZoom(fit.zoom)
    setPan(fit.pan)
  }, [board])

  useEffect(() => {
    fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const screenToMm = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return screenToBoardMm(clientX, clientY, rect, pan, zoom)
    },
    [pan, zoom],
  )

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * BUTTON_ZOOM_IN)), [])
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z * BUTTON_ZOOM_OUT)), [])

  const handleWheel = useCallback((event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? WHEEL_ZOOM_IN : WHEEL_ZOOM_OUT
    setZoom((z) => clampZoom(z * factor))
  }, [])

  return { svgRef, pan, setPan, zoom, fitView, screenToMm, zoomIn, zoomOut, handleWheel }
}

export type PcbViewport = ReturnType<typeof usePcbViewport>
