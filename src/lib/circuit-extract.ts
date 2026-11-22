/**
 * Pure extractors that turn tscircuit's flat `circuitJson` array into typed,
 * indexed structures for the interactive Schematic and PCB CAD editors.
 */

type RawEl = Record<string, unknown> & { type?: string }

export interface Point2D {
  x: number
  y: number
}

export interface SchematicPinView {
  id: string
  sourcePortId: string
  componentName: string
  pinLabel: string
  selector: string
  x: number
  y: number
  facing?: string
}

export interface SchematicCompView {
  id: string
  sourceId: string
  name: string
  ftype?: string
  value?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  pins: SchematicPinView[]
}

export interface SchematicWireView {
  id: string
  segments: { from: Point2D; to: Point2D }[]
}

export interface SchematicLabelView {
  id: string
  text: string
  x: number
  y: number
}

export interface SchematicScene {
  components: SchematicCompView[]
  wires: SchematicWireView[]
  labels: SchematicLabelView[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface PcbPadView {
  id: string
  componentName: string
  pinLabel: string
  x: number
  y: number
  width: number
  height: number
  shape: "rect" | "circle"
  layer: string
  isPlatedHole?: boolean
  netName?: string
}

export interface PcbCompView {
  id: string
  sourceId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  layer: string
  pads: PcbPadView[]
}

export interface PcbTraceView {
  id: string
  layer: string
  width: number
  points: Point2D[]
  netName?: string
  /** True for a hand-drawn `<pcbtrace>`: it has no source trace behind it. */
  manual?: boolean
}

export interface PcbViaView {
  id: string
  x: number
  y: number
  outerDiameter: number
  holeDiameter: number
  layers: string[]
}

export interface PcbBoardView {
  width: number
  height: number
  center: Point2D
  outline?: Point2D[]
}

export interface PcbScene {
  board: PcbBoardView
  components: PcbCompView[]
  traces: PcbTraceView[]
  vias: PcbViaView[]
  ratsnest: { from: Point2D; to: Point2D; netName?: string }[]
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

function pointOf(v: unknown): Point2D | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.x === "number" && typeof o.y === "number") return { x: o.x, y: o.y }
  return null
}

/** Extracts interactive schematic components, pins, wires, and net labels from circuitJson. */
export function extractSchematicScene(circuitJson: readonly unknown[]): SchematicScene {
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const sourceById = new Map<string, RawEl>()
  const sourcePortById = new Map<string, RawEl>()
  for (const el of elements) {
    if (el.type === "source_component" && str(el.source_component_id)) {
      sourceById.set(str(el.source_component_id)!, el)
    } else if (el.type === "source_port" && str(el.source_port_id)) {
      sourcePortById.set(str(el.source_port_id)!, el)
    }
  }

  const compBySchId = new Map<string, SchematicCompView>()
  const components: SchematicCompView[] = []

  for (const el of elements) {
    if (el.type !== "schematic_component") continue
    const id = str(el.schematic_component_id) ?? `sch_${components.length}`
    const sourceId = str(el.source_component_id) ?? ""
    const src = sourceById.get(sourceId)
    const name = str(src?.name) ?? id
    const center = pointOf(el.center) ?? { x: 0, y: 0 }
    const size = el.size && typeof el.size === "object" ? (el.size as Record<string, unknown>) : {}
    const width = Math.max(0.6, num(size.width, 1.4))
    const height = Math.max(0.4, num(size.height, 0.8))
    const value =
      str(src?.display_resistance) ??
      str(src?.display_capacitance) ??
      str(src?.display_inductance) ??
      str(src?.manufacturer_part_number) ??
      str(src?.color)
    const comp: SchematicCompView = {
      id,
      sourceId,
      name,
      ftype: str(src?.ftype),
      value,
      x: center.x,
      y: center.y,
      width,
      height,
      rotation: num(el.rotation, 0),
      pins: [],
    }
    compBySchId.set(id, comp)
    components.push(comp)
  }

  for (const el of elements) {
    if (el.type !== "schematic_port") continue
    const schCompId = str(el.schematic_component_id)
    const comp = schCompId ? compBySchId.get(schCompId) : undefined
    const center = pointOf(el.center)
    if (!comp || !center) continue
    const sourcePortId = str(el.source_port_id) ?? ""
    const srcPort = sourcePortById.get(sourcePortId)
    const pinNum = el.pin_number ?? srcPort?.pin_number
    const portName = str(srcPort?.name) ?? (pinNum !== undefined ? `pin${pinNum}` : "pin1")
    const pinLabel = str(el.display_pin_label) ?? portName
    comp.pins.push({
      id: str(el.schematic_port_id) ?? `${comp.id}_${comp.pins.length}`,
      sourcePortId,
      componentName: comp.name,
      pinLabel,
      selector: `.${comp.name} > .${portName}`,
      x: center.x,
      y: center.y,
      facing: str(el.facing_direction),
    })
  }

  const wires: SchematicWireView[] = []
  for (const el of elements) {
    if (el.type !== "schematic_trace" || !Array.isArray(el.edges)) continue
    const segments: { from: Point2D; to: Point2D }[] = []
    for (const edge of el.edges) {
      if (!edge || typeof edge !== "object") continue
      const from = pointOf((edge as Record<string, unknown>).from)
      const to = pointOf((edge as Record<string, unknown>).to)
      if (from && to) segments.push({ from, to })
    }
    if (segments.length > 0) {
      wires.push({ id: str(el.schematic_trace_id) ?? `w_${wires.length}`, segments })
    }
  }

  const labels: SchematicLabelView[] = []
  for (const el of elements) {
    if (el.type !== "schematic_net_label") continue
    const center = pointOf(el.center) ?? pointOf(el.anchor_position)
    const text = str(el.text)
    if (center && text) labels.push({ id: str(el.schematic_net_label_id) ?? `lbl_${labels.length}`, text, x: center.x, y: center.y })
  }

  let minX = -6
  let minY = -4
  let maxX = 6
  let maxY = 4
  if (components.length > 0) {
    minX = Infinity
    minY = Infinity
    maxX = -Infinity
    maxY = -Infinity
    for (const c of components) {
      minX = Math.min(minX, c.x - c.width / 2 - 1.5)
      maxX = Math.max(maxX, c.x + c.width / 2 + 1.5)
      minY = Math.min(minY, c.y - c.height / 2 - 1.5)
      maxY = Math.max(maxY, c.y + c.height / 2 + 1.5)
    }
  }

  return { components, wires, labels, bounds: { minX, minY, maxX, maxY } }
}

/** Extracts interactive PCB board, components, pads, copper traces, vias, and ratsnest from circuitJson. */
export function extractPcbScene(circuitJson: readonly unknown[]): PcbScene {
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const sourceById = new Map<string, RawEl>()
  const sourcePortById = new Map<string, RawEl>()
  const pcbPortById = new Map<string, RawEl>()
  const netById = new Map<string, string>()

  for (const el of elements) {
    if (el.type === "source_component" && str(el.source_component_id)) {
      sourceById.set(str(el.source_component_id)!, el)
    } else if (el.type === "source_port" && str(el.source_port_id)) {
      sourcePortById.set(str(el.source_port_id)!, el)
    } else if (el.type === "pcb_port" && str(el.pcb_port_id)) {
      pcbPortById.set(str(el.pcb_port_id)!, el)
    } else if (el.type === "source_net" && str(el.source_net_id) && str(el.name)) {
      netById.set(str(el.source_net_id)!, str(el.name)!)
    }
  }

  const boardEl = elements.find((el) => el.type === "pcb_board")
  const boardCenter = pointOf(boardEl?.center) ?? { x: 0, y: 0 }
  const outline = Array.isArray(boardEl?.outline)
    ? (boardEl.outline.map(pointOf).filter((p): p is Point2D => p !== null) as Point2D[])
    : undefined
  const board: PcbBoardView = {
    width: num(boardEl?.width, 30),
    height: num(boardEl?.height, 20),
    center: boardCenter,
    outline: outline && outline.length >= 3 ? outline : undefined,
  }

  const compByPcbId = new Map<string, PcbCompView>()
  const components: PcbCompView[] = []
  for (const el of elements) {
    if (el.type !== "pcb_component") continue
    const id = str(el.pcb_component_id) ?? `pcb_${components.length}`
    const sourceId = str(el.source_component_id) ?? ""
    const src = sourceById.get(sourceId)
    const center = pointOf(el.center) ?? { x: 0, y: 0 }
    const comp: PcbCompView = {
      id,
      sourceId,
      name: str(src?.name) ?? id,
      x: center.x,
      y: center.y,
      width: Math.max(0.8, num(el.width, 2)),
      height: Math.max(0.8, num(el.height, 1.2)),
      rotation: num(el.rotation, 0),
      layer: str(el.layer) ?? "top",
      pads: [],
    }
    compByPcbId.set(id, comp)
    components.push(comp)
  }

  // Pads & plated holes
  for (const el of elements) {
    if (el.type !== "pcb_smtpad" && el.type !== "pcb_plated_hole") continue
    const pcbCompId = str(el.pcb_component_id)
    const comp = pcbCompId ? compByPcbId.get(pcbCompId) : undefined
    const pcbPortId = str(el.pcb_port_id)
    const pcbPort = pcbPortId ? pcbPortById.get(pcbPortId) : undefined
    const srcPort = pcbPort && str(pcbPort.source_port_id) ? sourcePortById.get(str(pcbPort.source_port_id)!) : undefined
    const pinLabel = str(srcPort?.name) ?? "pad"
    const isHole = el.type === "pcb_plated_hole"
    const shape = el.shape === "circle" || isHole ? "circle" : "rect"
    const width = isHole ? num(el.outer_diameter, 1.2) : shape === "circle" ? num(el.radius, 0.4) * 2 : num(el.width, 0.8)
    const height = isHole ? num(el.outer_diameter, 1.2) : shape === "circle" ? width : num(el.height, 0.8)
    const pad: PcbPadView = {
      id: str(el.pcb_smtpad_id) ?? str(el.pcb_plated_hole_id) ?? `pad_${Math.random()}`,
      componentName: comp?.name ?? "",
      pinLabel,
      x: num(el.x, 0),
      y: num(el.y, 0),
      width,
      height,
      shape,
      layer: isHole ? "all" : (str(el.layer) ?? "top"),
      isPlatedHole: isHole,
    }
    if (comp) comp.pads.push(pad)
  }

  // Copper traces
  const traces: PcbTraceView[] = []
  for (const el of elements) {
    if (el.type !== "pcb_trace" || !Array.isArray(el.route)) continue
    const manual = !str(el.source_trace_id)
    let currentLayer = "top"
    let currentWidth = 0.2
    let currentPts: Point2D[] = []
    const flush = () => {
      if (currentPts.length >= 2) {
        traces.push({
          id: `${str(el.pcb_trace_id) ?? "tr"}_${traces.length}`,
          layer: currentLayer,
          width: currentWidth,
          points: currentPts,
          ...(manual ? { manual } : {}),
        })
      }
      currentPts = []
    }
    for (const seg of el.route) {
      if (!seg || typeof seg !== "object") continue
      const r = seg as Record<string, unknown>
      if (r.route_type === "via") {
        flush()
        continue
      }
      const layer = str(r.layer) ?? currentLayer
      const width = num(r.width, currentWidth)
      if (layer !== currentLayer && currentPts.length > 0) flush()
      currentLayer = layer
      currentWidth = width
      if (typeof r.x === "number" && typeof r.y === "number") {
        currentPts.push({ x: r.x, y: r.y })
      }
    }
    flush()
  }

  // Vias
  const vias: PcbViaView[] = []
  for (const el of elements) {
    if (el.type !== "pcb_via") continue
    vias.push({
      id: str(el.pcb_via_id) ?? `via_${vias.length}`,
      x: num(el.x, 0),
      y: num(el.y, 0),
      outerDiameter: num(el.outer_diameter, 0.6),
      holeDiameter: num(el.hole_diameter, 0.3),
      layers: Array.isArray(el.layers) ? el.layers.filter((l): l is string => typeof l === "string") : ["top", "bottom"],
    })
  }

  // Ratsnest (airwires from source_trace connections)
  const portCenterBySourcePort = new Map<string, Point2D>()
  for (const el of elements) {
    if (el.type === "pcb_port" && str(el.source_port_id) && typeof el.x === "number" && typeof el.y === "number") {
      portCenterBySourcePort.set(str(el.source_port_id)!, { x: el.x, y: el.y })
    }
  }
  const ratsnest: { from: Point2D; to: Point2D; netName?: string }[] = []
  for (const el of elements) {
    if (el.type !== "source_trace" || !Array.isArray(el.connected_source_port_ids)) continue
    const pts = el.connected_source_port_ids
      .map((id) => (typeof id === "string" ? portCenterBySourcePort.get(id) : undefined))
      .filter((p): p is Point2D => Boolean(p))
    const netIds = Array.isArray(el.connected_source_net_ids) ? el.connected_source_net_ids : []
    const netName = typeof netIds[0] === "string" ? netById.get(netIds[0]) : undefined
    for (let i = 0; i + 1 < pts.length; i += 1) {
      ratsnest.push({ from: pts[i], to: pts[i + 1], netName })
    }
  }

  return { board, components, traces, vias, ratsnest }
}

/** Generates the next unused component designator (e.g. R1, R2 -> R3). */
export function nextDesignator(prefix: string, existingNames: readonly string[]): string {
  const used = new Set(existingNames)
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${prefix}${i}`
    if (!used.has(candidate)) return candidate
  }
  return `${prefix}${Date.now() % 1000}`
}
