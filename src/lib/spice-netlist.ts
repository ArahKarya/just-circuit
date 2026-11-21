import { inferRailVoltage, parseOhms } from "./circuit-sim"

/**
 * Netlist extraction for the SPICE-class browser solvers: merges tscircuit
 * source ports/nets into nodes and turns R/C/L/LED/diode parts into branches.
 */

/** Dense solves are O(N^3) on the main thread; above this the tab would stall. */
export const MAX_SPICE_NODES = 100

const DEFAULT_CAP_F = 100e-9
const DEFAULT_IND_H = 10e-6
const DEFAULT_RES_OHM = 1000
const LED_VF = 2.0
const DIODE_VF = 0.7

type RawEl = Record<string, unknown> & { type?: string }
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

const GND_RE = /^((a|d|p|s|c)?(gnd|vss)[a-z0-9_]*|0v|ground|com)$/i

export const isGroundNetName = (name: string): boolean => GND_RE.test(name.trim())

const SI_PREFIX: Readonly<Record<string, number>> = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3 }

/**
 * Parses engineering notation for a unit ("F" or "H"): "4.7uF", "4.7μF", "4u7",
 * ".1u", "1e-6", "100n". Returns null for anything unparseable or non-positive.
 */
function parseEngineering(raw: unknown, unit: "F" | "H"): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== "string") return null
  const text = raw
    .trim()
    .replace(/[μµ]/g, "u")
    .replace(/\s+/g, "")
    .replace(new RegExp(`${unit}$`, "i"), "")
  const compact = text.match(/^(\d+)([pnumk])(\d+)$/i)
  const plain = text.match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([pnumk])?$/i)
  const value = compact
    ? Number(`${compact[1]}.${compact[3]}`) * SI_PREFIX[compact[2].toLowerCase()]
    : plain
      ? Number(`${plain[1]}${plain[2] ?? ""}`) * (plain[3] ? SI_PREFIX[plain[3].toLowerCase()] : 1)
      : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

export const parseFarads = (raw: unknown): number | null => parseEngineering(raw, "F")
export const parseHenries = (raw: unknown): number | null => parseEngineering(raw, "H")

export type BranchKind = "R" | "C" | "L" | "D"

export interface NetlistBranch {
  readonly id: string
  readonly name: string
  readonly kind: BranchKind
  /** Ohms, farads, henries, or forward voltage for diodes. */
  readonly value: number
  /** Node index; for diodes this is the anode. */
  readonly a: number
  /** Node index; for diodes this is the cathode. */
  readonly b: number
}

export interface Supply {
  readonly name: string
  readonly idx: number
  readonly voltage: number
}

export interface ExtractedNetlist {
  readonly nodeCount: number
  readonly labels: readonly string[]
  readonly groundIdx: readonly number[]
  readonly supplies: readonly Supply[]
  readonly branches: readonly NetlistBranch[]
  readonly warnings: readonly string[]
  readonly ignoredParts: readonly string[]
  readonly tooLarge: boolean
}

interface PortInfo {
  id: string
  names: string[]
}

interface CompInfo {
  id: string
  name: string
  ftype: string
  raw: RawEl
  ports: PortInfo[]
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let cur = x
    while (this.parent.has(cur) && this.parent.get(cur) !== cur) cur = this.parent.get(cur)!
    this.parent.set(x, cur)
    return cur
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

function collectParts(elements: readonly RawEl[]): { comps: Map<string, CompInfo>; nets: Map<string, RawEl> } {
  const comps = new Map<string, CompInfo>()
  const nets = new Map<string, RawEl>()
  for (const el of elements) {
    const cid = str(el.source_component_id)
    if (el.type === "source_component" && cid) {
      comps.set(cid, { id: cid, name: str(el.name) ?? cid, ftype: str(el.ftype) ?? "simple_chip", raw: el, ports: [] })
    } else if (el.type === "source_net" && str(el.source_net_id) && str(el.name)) {
      nets.set(str(el.source_net_id)!, el)
    }
  }
  for (const el of elements) {
    const pid = str(el.source_port_id)
    const comp = comps.get(str(el.source_component_id) ?? "")
    if (el.type !== "source_port" || !pid || !comp) continue
    const names = [str(el.name) ?? "", ...stringList(el.port_hints)].map((n) => n.toLowerCase()).filter(Boolean)
    comp.ports.push({ id: pid, names })
  }
  return { comps, nets }
}

function connect(elements: readonly RawEl[], comps: Map<string, CompInfo>, nets: Map<string, RawEl>): UnionFind {
  const uf = new UnionFind()
  for (const c of comps.values()) for (const p of c.ports) uf.find(`p:${p.id}`)
  for (const id of nets.keys()) uf.find(`n:${id}`)
  for (const el of elements) {
    if (el.type !== "source_trace") continue
    const keys = [...stringList(el.connected_source_port_ids).map((p) => `p:${p}`), ...stringList(el.connected_source_net_ids).map((n) => `n:${n}`)]
    for (let i = 1; i < keys.length; i += 1) uf.union(keys[0], keys[i])
  }
  // Nets with the same name are the same electrical node.
  const byUpper = new Map<string, string>()
  for (const [id, el] of nets.entries()) {
    const u = str(el.name)!.toUpperCase()
    if (byUpper.has(u)) uf.union(byUpper.get(u)!, `n:${id}`)
    else byUpper.set(u, `n:${id}`)
  }
  return uf
}

/** Resolves [anode, cathode] by port name / hints, like circuit-sim's DC solver. */
function diodePorts(ports: readonly PortInfo[]): [PortInfo, PortInfo] {
  const find = (names: readonly string[]) => ports.find((p) => p.names.some((n) => names.includes(n)))
  const anode = find(["anode", "pos", "a", "pin1"]) ?? ports[0]
  const cathode = find(["cathode", "neg", "k", "c", "pin2"]) ?? ports.find((p) => p !== anode) ?? ports[1]
  return [anode, cathode]
}

interface ValueSpec {
  kind: Exclude<BranchKind, "D">
  keys: readonly string[]
  parse: (raw: unknown) => number | null
  fallback: number
  fallbackLabel: string
  quantity: string
}

const VALUE_SPECS: Readonly<Record<string, ValueSpec>> = {
  simple_resistor: { kind: "R", keys: ["resistance", "display_resistance"], parse: parseOhms, fallback: DEFAULT_RES_OHM, fallbackLabel: "1kΩ", quantity: "resistansi" },
  simple_capacitor: { kind: "C", keys: ["capacitance", "display_capacitance"], parse: parseFarads, fallback: DEFAULT_CAP_F, fallbackLabel: "100nF", quantity: "kapasitansi" },
  simple_inductor: { kind: "L", keys: ["inductance", "display_inductance"], parse: parseHenries, fallback: DEFAULT_IND_H, fallbackLabel: "10µH", quantity: "induktansi" },
}

function readValue(c: CompInfo, spec: ValueSpec): { value: number; warning?: string } {
  const raw = spec.keys.map((k) => c.raw[k]).find((v) => v !== undefined && v !== null && v !== "")
  const parsed = spec.keys.map((k) => spec.parse(c.raw[k])).find((v): v is number => v !== null)
  if (parsed !== undefined) return { value: parsed }
  const shown = raw === undefined ? "kosong" : `"${String(raw)}" tidak terbaca`
  return { value: spec.fallback, warning: `${c.name}: nilai ${spec.quantity} ${shown}, memakai ${spec.fallbackLabel}.` }
}

interface BranchBuild {
  branches: NetlistBranch[]
  warnings: string[]
  ignoredParts: string[]
}

function buildBranches(comps: Map<string, CompInfo>, nodeOf: (portId: string) => number | undefined): BranchBuild {
  const out: BranchBuild = { branches: [], warnings: [], ignoredParts: [] }
  for (const c of comps.values()) {
    const isDiode = c.ftype === "simple_led" || c.ftype === "simple_diode"
    const spec = VALUE_SPECS[c.ftype]
    if (!spec && !isDiode) {
      out.ignoredParts.push(`${c.name} (${c.ftype.replace(/^simple_/, "")})`)
      continue
    }
    const [p1, p2] = isDiode ? diodePorts(c.ports) : [c.ports[0], c.ports[1]]
    const a = p1 ? nodeOf(p1.id) : undefined
    const b = p2 ? nodeOf(p2.id) : undefined
    if (a === undefined || b === undefined || p1 === p2) {
      out.ignoredParts.push(`${c.name} (pin kurang)`)
      continue
    }
    if (isDiode) {
      out.branches.push({ id: c.id, name: c.name, kind: "D", value: c.ftype === "simple_led" ? LED_VF : DIODE_VF, a, b })
      continue
    }
    const { value, warning } = readValue(c, spec)
    if (warning) out.warnings.push(warning)
    out.branches.push({ id: c.id, name: c.name, kind: spec.kind, value, a, b })
  }
  return out
}

const EMPTY: Omit<ExtractedNetlist, "nodeCount" | "tooLarge"> = {
  labels: [],
  groundIdx: [],
  supplies: [],
  branches: [],
  warnings: [],
  ignoredParts: [],
}

export function extractNetlist(circuitJson: readonly unknown[], maxNodes = MAX_SPICE_NODES): ExtractedNetlist {
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const { comps, nets } = collectParts(elements)
  const uf = connect(elements, comps, nets)

  const netsByRoot = new Map<string, RawEl[]>()
  for (const [id, el] of nets.entries()) {
    const r = uf.find(`n:${id}`)
    netsByRoot.set(r, [...(netsByRoot.get(r) ?? []), el])
  }
  const portRoots = [...comps.values()].flatMap((c) => c.ports.map((p) => uf.find(`p:${p.id}`)))
  const roots = [...new Set([...portRoots, ...netsByRoot.keys()])]
  if (roots.length > maxNodes) return { ...EMPTY, nodeCount: roots.length, tooLarge: true }

  const idxByRoot = new Map(roots.map((r, i) => [r, i] as const))
  const labels: string[] = []
  const groundIdx: number[] = []
  const supplies: Supply[] = []
  roots.forEach((r, i) => {
    const rootNets = netsByRoot.get(r) ?? []
    const names = rootNets.map((el) => str(el.name)!)
    labels.push(names[0] ?? `N${i + 1}`)
    const isGround = rootNets.some((el) => el.is_ground === true || isGroundNetName(str(el.name)!))
    if (isGround) {
      groundIdx.push(i)
      return
    }
    for (const name of names) {
      const voltage = inferRailVoltage(name)
      if (voltage !== null && voltage > 0) supplies.push({ name, idx: i, voltage })
    }
  })

  const built = buildBranches(comps, (pid) => idxByRoot.get(uf.find(`p:${pid}`)))
  return { nodeCount: roots.length, labels, groundIdx, supplies, ...built, tooLarge: false }
}
