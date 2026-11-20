/**
 * DC Operating Point (MNA) Circuit Simulator & Electrical/Current Safety Analyzer.
 * Extracts the netlist directly from tscircuit's `circuitJson`, solves node voltages
 * and branch currents, and checks for shorts, overcurrent, LED polarity/limiting,
 * resistor power dissipation, and floating pins.
 */

type RawEl = Record<string, unknown> & { type?: string }

export type SimSeverity = "error" | "warning" | "info"

export interface SimFinding {
  id: string
  severity: SimSeverity
  code:
    | "short_circuit"
    | "led_overcurrent"
    | "led_reverse"
    | "led_undervoltage"
    | "resistor_overpower"
    | "high_current"
    | "no_ground"
    | "no_supply"
    | "floating_pin"
    | "ic_unpowered"
  title: string
  detail: string
  components: string[]
}

export interface SimComponentResult {
  name: string
  ftype: string
  value: string
  footprint?: string
  voltageDrop: number
  currentMa: number
  powerMw: number
  maxPowerMw?: number
  status: "ok" | "error" | "warning" | "off"
  note?: string
}

export interface SimNodeResult {
  id: string
  label: string
  voltage: number
  isGround: boolean
  isSupply: boolean
  pins: string[]
}

export interface PowerRailSpec {
  nodeId: string
  name: string
  voltage: number
}

export interface SimulationOptions {
  /** Override voltages by rail name (e.g. { VCC: 3.3, V5: 5 }). */
  railVoltages?: Record<string, number>
  /** Default voltage when a generic VCC/VDD rail has no number in its name. */
  defaultVcc?: number
  /** Pushbutton/switch names currently held closed. */
  closedSwitches?: ReadonlySet<string>
}

export interface SimulationReport {
  ok: boolean
  totalCurrentMa: number
  totalPowerMw: number
  rails: PowerRailSpec[]
  switches: string[]
  nodes: SimNodeResult[]
  components: SimComponentResult[]
  findings: SimFinding[]
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

const GND_PATTERN = /^(gnd|agnd|dgnd|pgnd|vss|0v|ground|com)$/i
const POWER_PREFIX = /^(vcc|vdd|vbus|vin|vbat|vsys|avcc|dvcc|avdd|dvdd|v\d+(?:[._]\d+)?|\+?\d+(?:\.\d+)?v|\d+v\d+|p\d+v\d*)$/i

/** Parses engineering notation like "10k", "4k7", "330", "1.5M", "100R", "0.1" into ohms. */
export function parseOhms(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw !== "string") return null
  const clean = raw.trim().replace(/Ω|ohm(s)?/gi, "").trim()
  // European/compact notation: 4k7 -> 4.7k, 2R2 -> 2.2
  const compact = clean.match(/^(\d+)([rRkKmMgG])(\d+)$/)
  if (compact) {
    const val = Number(`${compact[1]}.${compact[3]}`)
    const mult = unitMultiplier(compact[2])
    return Number.isFinite(val) ? val * mult : null
  }
  const m = clean.match(/^(\d+(?:\.\d+)?)\s*([rRkKmMgG])?$/)
  if (!m) return null
  const val = Number(m[1])
  if (!Number.isFinite(val) || val <= 0) return null
  return val * unitMultiplier(m[2] ?? "")
}

function unitMultiplier(u: string): number {
  switch (u) {
    case "k":
    case "K":
      return 1e3
    case "M":
      return 1e6
    case "G":
    case "g":
      return 1e9
    case "m":
      return 1e-3
    default:
      return 1
  }
}

/** Infers DC voltage from a power net name (e.g. "3V3" -> 3.3, "V5" -> 5, "VCC" -> defaultVcc). */
export function inferRailVoltage(netName: string, defaultVcc = 5): number | null {
  if (GND_PATTERN.test(netName)) return 0
  // e.g. 3V3, 1V8, V3_3, V3.3, +5V, 12V, P5V
  const vInline = netName.match(/^P?(\d+)V(\d+)$/i)
  if (vInline) return Number(`${vInline[1]}.${vInline[2]}`)
  const vPrefix = netName.match(/^V(\d+)[._](\d+)$/i)
  if (vPrefix) return Number(`${vPrefix[1]}.${vPrefix[2]}`)
  const vSimple = netName.match(/^[+P]?V?(\d+(?:\.\d+)?)V?$/i)
  if (vSimple && /v/i.test(netName)) return Number(vSimple[1])
  if (/^vbus$/i.test(netName)) return 5
  if (/^vbat$/i.test(netName)) return 3.7
  if (/^(vcc|vdd|vin|vsys|avcc|dvcc|avdd|dvdd)$/i.test(netName)) return defaultVcc
  return null
}

function ledForwardVoltage(color: string | undefined): number {
  const c = (color ?? "").toLowerCase()
  if (c.includes("blue") || c.includes("white") || c.includes("biru") || c.includes("putih")) return 3.0
  if (c.includes("green") || c.includes("hijau")) return 2.2
  if (c.includes("yellow") || c.includes("amber") || c.includes("orange") || c.includes("kuning")) return 2.0
  return 1.9 // red / default
}

function resistorPowerRatingMw(footprint: string | undefined): number {
  const fp = (footprint ?? "").toLowerCase()
  if (fp.includes("0201")) return 50
  if (fp.includes("0402")) return 62.5
  if (fp.includes("0603")) return 100
  if (fp.includes("0805")) return 125
  if (fp.includes("1206")) return 250
  if (fp.includes("2512")) return 1000
  return 250
}

/** Disjoint-set (Union-Find) for merging electrically connected ports and nets. */
class UnionFind {
  private parent = new Map<string, string>()

  find(x: string): string {
    let cur = x
    while (this.parent.has(cur) && this.parent.get(cur) !== cur) {
      cur = this.parent.get(cur)!
    }
    if (!this.parent.has(x)) this.parent.set(x, cur)
    else this.parent.set(x, cur)
    return cur
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/** Solves linear system A * x = b via Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    let maxVal = Math.abs(M[col][col])
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(M[r][col])
      if (v > maxVal) {
        maxVal = v
        pivotRow = r
      }
    }
    if (maxVal < 1e-14) continue
    if (pivotRow !== col) {
      const tmp = M[col]
      M[col] = M[pivotRow]
      M[pivotRow] = tmp
    }
    const pivot = M[col][col]
    for (let r = col + 1; r < n; r += 1) {
      const factor = M[r][col] / pivot
      if (factor === 0) continue
      for (let c = col; c <= n; c += 1) {
        M[r][c] -= factor * M[col][c]
      }
    }
  }

  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = M[i][n]
    for (let j = i + 1; j < n; j += 1) sum -= M[i][j] * x[j]
    const diag = M[i][i]
    x[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0
  }
  return x
}

interface InternalComp {
  id: string
  name: string
  ftype: string
  value: string
  resistanceOhms?: number | null
  color?: string
  footprint?: string
  ports: { id: string; name: string; pinNumber?: number }[]
}

/** Runs DC electrical simulation and safety checks on a rendered tscircuit `circuitJson`. */
export function simulateCircuit(circuitJson: readonly unknown[], options: SimulationOptions = {}): SimulationReport {
  const defaultVcc = options.defaultVcc ?? 5
  const closedSwitches = options.closedSwitches ?? new Set<string>()
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")

  const compMap = new Map<string, InternalComp>()
  const portToComp = new Map<string, string>()
  const portById = new Map<string, { id: string; compId: string; compName: string; name: string; pinNumber?: number }>()
  const netById = new Map<string, string>()
  const footprintBySourceId = new Map<string, string>()

  for (const el of elements) {
    if (el.type === "source_component" && str(el.source_component_id)) {
      const id = str(el.source_component_id)!
      const name = str(el.name) ?? id
      const ftype = str(el.ftype) ?? "simple_chip"
      const rawRes = el.resistance ?? el.display_resistance
      const value =
        str(el.display_resistance) ??
        str(el.display_capacitance) ??
        str(el.display_inductance) ??
        str(el.color) ??
        str(el.manufacturer_part_number) ??
        (typeof el.resistance === "number" ? `${el.resistance}Ω` : "")
      compMap.set(id, {
        id,
        name,
        ftype,
        value,
        resistanceOhms: parseOhms(rawRes),
        color: str(el.color),
        ports: [],
      })
    } else if (el.type === "source_net" && str(el.source_net_id) && str(el.name)) {
      netById.set(str(el.source_net_id)!, str(el.name)!)
    } else if (el.type === "pcb_component" && str(el.source_component_id)) {
      const fp = str(el.footprint) ?? str(el.pcb_footprint)
      if (fp) footprintBySourceId.set(str(el.source_component_id)!, fp)
    }
  }

  for (const el of elements) {
    if (el.type !== "source_port" || !str(el.source_port_id) || !str(el.source_component_id)) continue
    const portId = str(el.source_port_id)!
    const compId = str(el.source_component_id)!
    const comp = compMap.get(compId)
    if (!comp) continue
    const portName = str(el.name) ?? (num(el.pin_number) !== undefined ? `pin${num(el.pin_number)}` : `pin${comp.ports.length + 1}`)
    const port = { id: portId, name: portName, pinNumber: num(el.pin_number) }
    comp.ports.push(port)
    portToComp.set(portId, compId)
    portById.set(portId, { id: portId, compId, compName: comp.name, name: portName, pinNumber: port.pinNumber })
  }

  // Merge connected ports & nets via Union-Find
  const uf = new UnionFind()
  for (const portId of portById.keys()) uf.find(`p:${portId}`)
  for (const netId of netById.keys()) uf.find(`n:${netId}`)

  for (const el of elements) {
    if (el.type !== "source_trace") continue
    const ports = Array.isArray(el.connected_source_port_ids) ? el.connected_source_port_ids.filter((v): v is string => typeof v === "string") : []
    const nets = Array.isArray(el.connected_source_net_ids) ? el.connected_source_net_ids.filter((v): v is string => typeof v === "string") : []
    const keys = [...ports.map((p) => `p:${p}`), ...nets.map((n) => `n:${n}`)]
    for (let i = 1; i < keys.length; i += 1) {
      uf.union(keys[0], keys[i])
    }
  }

  // Also merge nets with identical names (e.g. two net.GND references)
  const netKeyByName = new Map<string, string>()
  for (const [netId, netName] of netById.entries()) {
    const norm = netName.toUpperCase()
    const existing = netKeyByName.get(norm)
    if (existing) uf.union(existing, `n:${netId}`)
    else netKeyByName.set(norm, `n:${netId}`)
  }

  // Group into electrical nodes
  const nodeNetNames = new Map<string, Set<string>>()
  const nodePins = new Map<string, string[]>()

  for (const [netId, netName] of netById.entries()) {
    const root = uf.find(`n:${netId}`)
    if (!nodeNetNames.has(root)) nodeNetNames.set(root, new Set())
    nodeNetNames.get(root)!.add(netName)
  }
  for (const [portId, info] of portById.entries()) {
    const root = uf.find(`p:${portId}`)
    if (!nodePins.has(root)) nodePins.set(root, [])
    nodePins.get(root)!.push(`${info.compName}.${info.name}`)
    // Check if the port itself is named GND / VCC on a single-pin header or power symbol
    if (GND_PATTERN.test(info.name) || POWER_PREFIX.test(info.name)) {
      if (!nodeNetNames.has(root)) nodeNetNames.set(root, new Set())
      // Only infer from pin name if no explicit source_net is attached yet
      if (nodeNetNames.get(root)!.size === 0 && (info.compName.startsWith("J") || info.compName.startsWith("U"))) {
        nodeNetNames.get(root)!.add(info.name)
      }
    }
  }

  const allRoots = [...new Set([...nodeNetNames.keys(), ...nodePins.keys()])]
  const nodeIndex = new Map<string, number>()
  const nodeLabels = new Map<string, string>()
  const groundNodes = new Set<string>()
  const supplyNodes = new Map<string, { name: string; voltage: number }>()
  const findings: SimFinding[] = []

  allRoots.forEach((root, idx) => {
    nodeIndex.set(root, idx)
    const names = [...(nodeNetNames.get(root) ?? [])]
    const label = names[0] ?? `N${idx + 1}`
    nodeLabels.set(root, label)

    const hasGnd = names.some((n) => GND_PATTERN.test(n))
    const powerNames = names.filter((n) => !GND_PATTERN.test(n) && inferRailVoltage(n, defaultVcc) !== null)

    if (hasGnd) groundNodes.add(root)
    if (powerNames.length > 0) {
      const railName = powerNames[0]
      const override = options.railVoltages?.[railName]
      const voltage = override !== undefined && Number.isFinite(override) ? override : (inferRailVoltage(railName, defaultVcc) ?? defaultVcc)
      supplyNodes.set(root, { name: railName, voltage })

      // Direct rail-to-GND short on the exact same node!
      if (hasGnd && voltage !== 0) {
        findings.push({
          id: `short:${root}`,
          severity: "error",
          code: "short_circuit",
          title: `Hubung singkat langsung: ${railName} terhubung ke GND`,
          detail: `Net daya ${railName} (${voltage}V) dan GND berada pada node listrik yang sama (${(nodePins.get(root) ?? []).slice(0, 6).join(", ")}).`,
          components: [...new Set((nodePins.get(root) ?? []).map((p) => p.split(".")[0]))],
        })
      }
    }
  })

  if (groundNodes.size === 0 && compMap.size > 0) {
    findings.push({
      id: "no-ground",
      severity: "warning",
      code: "no_ground",
      title: "Tidak ditemukan net GND",
      detail: "Tambahkan koneksi ke net.GND sebagai referensi 0V agar simulasi arus dan tegangan akurat.",
      components: [],
    })
  }
  if (supplyNodes.size === 0 && compMap.size > 0) {
    findings.push({
      id: "no-supply",
      severity: "warning",
      code: "no_supply",
      title: "Tidak ditemukan sumber tegangan (VCC / 3V3 / 5V)",
      detail: "Hubungkan net daya seperti net.VCC, net.V5, atau net.V3_3 untuk mensimulasikan aliran arus.",
      components: [],
    })
  }

  // Helper to get two-terminal node indices for a component
  const getTwoNodes = (comp: InternalComp): [number, number] | null => {
    if (comp.ports.length < 2) return null
    const findPort = (pred: (name: string) => boolean) => comp.ports.find((p) => pred(p.name.toLowerCase()))
    let p1 = comp.ports[0]
    let p2 = comp.ports[1]
    if (comp.ftype === "simple_led" || comp.ftype === "simple_diode") {
      p1 = findPort((n) => n === "anode" || n === "pos" || n === "pin1") ?? comp.ports[0]
      p2 = findPort((n) => n === "cathode" || n === "neg" || n === "pin2") ?? comp.ports[1]
    }
    const n1 = nodeIndex.get(uf.find(`p:${p1.id}`))
    const n2 = nodeIndex.get(uf.find(`p:${p2.id}`))
    if (n1 === undefined || n2 === undefined) return null
    return [n1, n2]
  }

  // Iterative DC MNA solver (handles nonlinear diodes/LEDs cleanly in <= 12 iterations)
  const N = allRoots.length
  const diodeConducting = new Map<string, boolean>()
  let voltages = new Array<number>(N).fill(0)

  const addConductance = (G: number[][], a: number, b: number, g: number) => {
    if (a === b) return
    G[a][a] += g
    G[b][b] += g
    G[a][b] -= g
    G[b][a] -= g
  }

  for (let iter = 0; iter < 12; iter += 1) {
    const G = Array.from({ length: N }, () => new Array<number>(N).fill(0))
    const I = new Array<number>(N).fill(0)

    // Tiny gmin to ground on every node to prevent singular matrices on floating islands
    for (let i = 0; i < N; i += 1) G[i][i] += 1e-9

    // Stamp ground nodes (very stiff 0V reference)
    for (const root of groundNodes) {
      const idx = nodeIndex.get(root)!
      G[idx][idx] += 1e6
    }

    // Stamp power rails (ideal voltage source with 0.01 ohm internal resistance so shorts produce finite huge current)
    const R_SRC = 0.01
    for (const [root, rail] of supplyNodes.entries()) {
      if (groundNodes.has(root)) continue // already shorted directly to GND
      const idx = nodeIndex.get(root)!
      const g = 1 / R_SRC
      G[idx][idx] += g
      I[idx] += rail.voltage * g
    }

    // Stamp components
    for (const comp of compMap.values()) {
      const pair = getTwoNodes(comp)
      if (!pair) continue
      const [a, b] = pair
      if (comp.ftype === "simple_resistor") {
        const r = comp.resistanceOhms && comp.resistanceOhms > 0 ? comp.resistanceOhms : 1000
        addConductance(G, a, b, 1 / r)
      } else if (comp.ftype === "simple_inductor") {
        addConductance(G, a, b, 1 / 0.1)
      } else if (comp.ftype === "simple_capacitor") {
        addConductance(G, a, b, 1e-8)
      } else if (comp.ftype === "simple_pushbutton" || comp.ftype === "simple_switch") {
        const r = closedSwitches.has(comp.name) ? 0.1 : 1e8
        addConductance(G, a, b, 1 / r)
      } else if (comp.ftype === "simple_led" || comp.ftype === "simple_diode") {
        const vf = comp.ftype === "simple_led" ? ledForwardVoltage(comp.color) : 0.7
        const ron = comp.ftype === "simple_led" ? 10 : 5
        const isOn = diodeConducting.get(comp.id) ?? false
        if (isOn) {
          const g = 1 / ron
          addConductance(G, a, b, g)
          // Norton equivalent of series voltage drop Vf from a -> b:
          // Current leaves a and enters b of magnitude Vf / ron? No: I_ab = (Va - Vb - Vf) / ron
          // => G*Va - G*Vb = +G*Vf (into a: -G*Vf; into b: +G*Vf)
          I[a] += vf * g
          I[b] -= vf * g
        } else {
          addConductance(G, a, b, 1e-7)
        }
      }
    }

    const nextV = N > 0 ? solveLinear(G, I) : []
    let changed = false
    for (const comp of compMap.values()) {
      if (comp.ftype !== "simple_led" && comp.ftype !== "simple_diode") continue
      const pair = getTwoNodes(comp)
      if (!pair) continue
      const [a, b] = pair
      const vf = comp.ftype === "simple_led" ? ledForwardVoltage(comp.color) : 0.7
      const vd = nextV[a] - nextV[b]
      const shouldBeOn = vd > vf
      if (shouldBeOn !== (diodeConducting.get(comp.id) ?? false)) {
        diodeConducting.set(comp.id, shouldBeOn)
        changed = true
      }
    }
    voltages = nextV
    if (!changed) break
  }

  // Evaluate component telemetry & electrical safety checks
  const compResults: SimComponentResult[] = []
  const switches: string[] = []
  let totalPowerMw = 0

  for (const comp of compMap.values()) {
    const footprint = footprintBySourceId.get(comp.id)
    if (comp.ftype === "simple_pushbutton" || comp.ftype === "simple_switch") {
      switches.push(comp.name)
    }

    const pair = getTwoNodes(comp)
    if (!pair) {
      // Multi-pin IC / chip check: verify VCC / GND connectivity
      const powerPin = comp.ports.find((p) => /^(vcc|vdd|vin|3v3|5v)$/i.test(p.name))
      const gndPin = comp.ports.find((p) => GND_PATTERN.test(p.name))
      let status: SimComponentResult["status"] = "ok"
      let note: string | undefined
      if (powerPin && gndPin) {
        const vp = voltages[nodeIndex.get(uf.find(`p:${powerPin.id}`)) ?? 0] ?? 0
        const vg = voltages[nodeIndex.get(uf.find(`p:${gndPin.id}`)) ?? 0] ?? 0
        const vdd = vp - vg
        if (vdd < 0.5 && supplyNodes.size > 0) {
          status = "warning"
          note = "Pin daya IC tidak mendapat tegangan"
          findings.push({
            id: `ic-unpowered:${comp.name}`,
            severity: "warning",
            code: "ic_unpowered",
            title: `${comp.name}: pin daya tidak bertegangan (${vdd.toFixed(2)}V)`,
            detail: `Pin ${powerPin.name} (${vp.toFixed(2)}V) terhadap ${gndPin.name} (${vg.toFixed(2)}V) tidak mendapat suplai daya.`,
            components: [comp.name],
          })
        } else {
          note = `Suplai ${vdd.toFixed(2)}V`
        }
      }
      compResults.push({
        name: comp.name,
        ftype: comp.ftype,
        value: comp.value,
        footprint,
        voltageDrop: 0,
        currentMa: 0,
        powerMw: 0,
        status,
        note,
      })
      continue
    }

    const [a, b] = pair
    const vd = voltages[a] - voltages[b]
    let currentA = 0
    let status: SimComponentResult["status"] = "ok"
    let note: string | undefined
    let maxPowerMw: number | undefined

    if (comp.ftype === "simple_resistor") {
      const r = comp.resistanceOhms && comp.resistanceOhms > 0 ? comp.resistanceOhms : 1000
      currentA = vd / r
      maxPowerMw = resistorPowerRatingMw(footprint)
      const pMw = Math.abs(vd * currentA) * 1000
      if (pMw > maxPowerMw) {
        status = "error"
        note = `Daya ${pMw.toFixed(1)}mW > batas ${maxPowerMw}mW`
        findings.push({
          id: `res-overpower:${comp.name}`,
          severity: "error",
          code: "resistor_overpower",
          title: `${comp.name} kelebihan daya (${pMw.toFixed(1)} mW / maks ${maxPowerMw} mW)`,
          detail: `Resistor ${comp.name} (${comp.value || `${r}Ω`}, arus ${(Math.abs(currentA) * 1000).toFixed(1)} mA) melebihi rating paket ${footprint ?? "standar"} dan berisiko terbakar. Naikkan nilai resistansi atau gunakan paket lebih besar.`,
          components: [comp.name],
        })
      } else if (pMw > maxPowerMw * 0.8) {
        status = "warning"
        note = `Mendekati batas daya (${pMw.toFixed(1)}/${maxPowerMw}mW)`
      }
    } else if (comp.ftype === "simple_led") {
      const vf = ledForwardVoltage(comp.color)
      const on = diodeConducting.get(comp.id) ?? false
      currentA = on ? Math.max(0, (vd - vf) / 10) : 0
      const iMa = currentA * 1000
      if (iMa > 30) {
        status = "error"
        note = `Arus berlebih ${iMa.toFixed(1)}mA (maks ~20mA)`
        findings.push({
          id: `led-overcurrent:${comp.name}`,
          severity: "error",
          code: "led_overcurrent",
          title: `${comp.name} kelebihan arus (${iMa.toFixed(1)} mA)`,
          detail: `Arus LED ${comp.name} mencapai ${iMa.toFixed(1)} mA (batas aman umum 20 mA). Tambahkan atau perbesar resistor pembatas arus seri.`,
          components: [comp.name],
        })
      } else if (iMa > 20) {
        status = "warning"
        note = `Arus tinggi ${iMa.toFixed(1)}mA`
        findings.push({
          id: `led-warn-current:${comp.name}`,
          severity: "warning",
          code: "led_overcurrent",
          title: `${comp.name} arus cukup tinggi (${iMa.toFixed(1)} mA)`,
          detail: `Arus LED ${comp.name} berada di atas 20 mA; pertimbangkan menaikkan resistor pembatas arus.`,
          components: [comp.name],
        })
      } else if (vd < -0.5) {
        status = "warning"
        note = `Polaritas terbalik (${vd.toFixed(2)}V)`
        findings.push({
          id: `led-reverse:${comp.name}`,
          severity: "warning",
          code: "led_reverse",
          title: `${comp.name} terpasang terbalik (reverse bias ${vd.toFixed(2)}V)`,
          detail: `Tegangan katoda lebih tinggi dari anoda pada LED ${comp.name}, sehingga LED tidak akan menyala.`,
          components: [comp.name],
        })
      } else if (iMa < 0.2) {
        status = "off"
        note = `Mati (V=${vd.toFixed(2)}V < Vf ${vf}V)`
      } else {
        note = `Menyala (${iMa.toFixed(1)} mA)`
      }
    } else if (comp.ftype === "simple_diode") {
      const on = diodeConducting.get(comp.id) ?? false
      currentA = on ? Math.max(0, (vd - 0.7) / 5) : 0
      const iMa = currentA * 1000
      if (iMa > 1000) {
        status = "error"
        note = `Arus sangat tinggi ${iMa.toFixed(0)}mA`
        findings.push({
          id: `diode-high:${comp.name}`,
          severity: "error",
          code: "high_current",
          title: `${comp.name} arus sangat tinggi (${iMa.toFixed(0)} mA)`,
          detail: `Dioda ${comp.name} mengalirkan arus berlebih (${iMa.toFixed(0)} mA). Cek jalur hubung singkat atau pembatas arus.`,
          components: [comp.name],
        })
      }
    } else if (comp.ftype === "simple_inductor") {
      currentA = vd / 0.1
      if (Math.abs(currentA) > 1) {
        status = "warning"
        note = `Arus DC tinggi ${(Math.abs(currentA) * 1000).toFixed(0)}mA`
      }
    } else if (comp.ftype === "simple_pushbutton" || comp.ftype === "simple_switch") {
      const closed = closedSwitches.has(comp.name)
      currentA = closed ? vd / 0.1 : 0
      note = closed ? "Tertutup (ditekan)" : "Terbuka"
    }

    const powerMw = Math.abs(vd * currentA) * 1000
    totalPowerMw += powerMw
    compResults.push({
      name: comp.name,
      ftype: comp.ftype,
      value: comp.value,
      footprint,
      voltageDrop: Number(vd.toFixed(3)),
      currentMa: Number((Math.abs(currentA) * 1000).toFixed(2)),
      powerMw: Number(powerMw.toFixed(2)),
      maxPowerMw,
      status,
      note,
    })
  }

  // Compute total supply current drawn from all power rails
  let totalSupplyCurrentA = 0
  const rails: PowerRailSpec[] = []
  for (const [root, rail] of supplyNodes.entries()) {
    rails.push({ nodeId: root, name: rail.name, voltage: rail.voltage })
    if (groundNodes.has(root)) continue
    const idx = nodeIndex.get(root)!
    const drawnA = Math.max(0, (rail.voltage - voltages[idx]) / 0.01)
    totalSupplyCurrentA += drawnA
    if (drawnA > 2.0) {
      findings.push({
        id: `rail-short:${rail.name}`,
        severity: "error",
        code: "short_circuit",
        title: `Arus berlebih / hubung singkat di rail ${rail.name} (${(drawnA * 1000).toFixed(0)} mA)`,
        detail: `Rail ${rail.name} (${rail.voltage}V) menarik arus sangat besar (${drawnA.toFixed(2)} A). Periksa jalur dengan resistansi terlalu rendah menuju GND.`,
        components: [...new Set((nodePins.get(root) ?? []).map((p) => p.split(".")[0]))],
      })
    }
  }

  const nodes: SimNodeResult[] = allRoots.map((root, idx) => ({
    id: root,
    label: nodeLabels.get(root) ?? `N${idx + 1}`,
    voltage: Number((voltages[idx] ?? 0).toFixed(3)),
    isGround: groundNodes.has(root),
    isSupply: supplyNodes.has(root),
    pins: nodePins.get(root) ?? [],
  }))

  const hasErrors = findings.some((f) => f.severity === "error")

  return {
    ok: !hasErrors,
    totalCurrentMa: Number((totalSupplyCurrentA * 1000).toFixed(2)),
    totalPowerMw: Number(totalPowerMw.toFixed(2)),
    rails,
    switches,
    nodes,
    components: compResults,
    findings: findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)),
  }
}
