import type { DesignIssue } from "./drc"
import { listComponents } from "./tsx-ast"
import type { ProjectFiles } from "./types"

type RawEl = Record<string, unknown> & { type?: string }

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
// Ground: GND, AGND, GND_ISO, GNDA, VSS, VSSA, 0V, GROUND, COM.
const GND_RE = /^((a|d|p|s|c)?(gnd|vss)[a-z0-9_]*|0v|ground|com)$/i
// Power: VCC*, VDD* (VDDIO, VCC_3V3), AVDD/DVDD, VBUS, VIN, VBAT, VSYS, V+, +3V3, +5V, 3V3, 12V, V3_3, V5.
const PWR_RE = /^(\+?(a|d)?(vcc|vdd|vbus|vin|vbat|vsys)[a-z0-9_]*|v\+|\+?\d+v\d*|v\d+(_\d+)?)$/i

export const isGroundName = (name: string): boolean => GND_RE.test(name.trim())
export const isPowerName = (name: string): boolean => !isGroundName(name) && PWR_RE.test(name.trim())

const portNames = (el: RawEl): string[] => {
  const hints = Array.isArray(el.port_hints) ? el.port_hints.filter((h): h is string => typeof h === "string") : []
  return [str(el.name) ?? "", ...hints].filter(Boolean)
}
const isGroundPort = (el: RawEl): boolean => portNames(el).some(isGroundName)
const isPowerPort = (el: RawEl): boolean => portNames(el).some(isPowerName)

/**
 * KiCad-style Electrical Rules Check (ERC) combining static TSX checks
 * and circuit-json connectivity analysis.
 */
export function runExtendedErc(files: ProjectFiles, circuitJson: readonly unknown[] | null): DesignIssue[] {
  const issues: DesignIssue[] = []
  const comps = listComponents(files)

  // 1. Duplicate designators
  const byName = new Map<string, string[]>()
  for (const c of comps) {
    if (!byName.has(c.name)) byName.set(c.name, [])
    byName.get(c.name)!.push(c.path)
  }
  for (const [name, paths] of byName.entries()) {
    if (paths.length > 1) {
      issues.push({
        key: `erc:dup:${name}`,
        severity: "error",
        category: "schematic",
        type: "erc_duplicate_designator",
        message: `Designator duplikat "${name}" muncul ${paths.length}× (${[...new Set(paths)].join(", ")})`,
        components: [name],
      })
    }
  }

  // 2. Chips without MPN
  for (const c of comps) {
    if (c.tagName === "chip" && !c.manufacturerPartNumber) {
      issues.push({
        key: `erc:mpn:${c.name}`,
        severity: "warning",
        category: "schematic",
        type: "erc_missing_mpn",
        message: `IC ${c.name} belum memiliki manufacturerPartNumber (penting untuk BOM & skematik).`,
        components: [c.name],
      })
    }
  }

  if (!circuitJson || circuitJson.length === 0) return issues

  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const connectedPorts = collectConnectedPorts(elements)
  return [...issues, ...unconnectedPowerPinIssues(elements, connectedPorts), ...missingGroundIssues(elements, connectedPorts)]
}

function collectConnectedPorts(elements: readonly RawEl[]): Set<string> {
  const ids = elements
    .filter((el) => el.type === "source_trace" && Array.isArray(el.connected_source_port_ids))
    .flatMap((el) => (el.connected_source_port_ids as unknown[]).filter((pid): pid is string => typeof pid === "string"))
  return new Set(ids)
}

/** 3. Power/ground pins (by name or port_hints) that no trace touches. */
function unconnectedPowerPinIssues(elements: readonly RawEl[], connectedPorts: ReadonlySet<string>): DesignIssue[] {
  const nameById = new Map(
    elements
      .filter((el) => el.type === "source_component" && str(el.source_component_id) && str(el.name))
      .map((el) => [str(el.source_component_id)!, str(el.name)!] as const),
  )
  return elements.flatMap((el): DesignIssue[] => {
    const pid = str(el.source_port_id)
    const cid = str(el.source_component_id)
    if (el.type !== "source_port" || !pid || !cid || connectedPorts.has(pid)) return []
    if (!isGroundPort(el) && !isPowerPort(el)) return []
    const compName = nameById.get(cid) ?? cid
    const portName = str(el.name) ?? pid
    return [
      {
        key: `erc:unconn:${pid}`,
        severity: "error",
        category: "schematic",
        type: "erc_unconnected_power_pin",
        message: `Pin daya ${compName}.${portName} tidak terhubung ke net mana pun.`,
        components: [compName],
      },
    ]
  })
}

/** 4. A power net exists but nothing in the design acts as ground. */
function missingGroundIssues(elements: readonly RawEl[], connectedPorts: ReadonlySet<string>): DesignIssue[] {
  const nets = elements.filter((el) => el.type === "source_net")
  const hasPower = nets.some((el) => el.is_power === true || isPowerName(str(el.name) ?? ""))
  const hasGroundNet = nets.some((el) => el.is_ground === true || isGroundName(str(el.name) ?? ""))
  const hasGroundPin = elements.some(
    (el) => el.type === "source_port" && connectedPorts.has(str(el.source_port_id) ?? "") && isGroundPort(el),
  )
  if (!hasPower || hasGroundNet || hasGroundPin) return []
  return [
    {
      key: "erc:missing-gnd",
      severity: "warning",
      category: "schematic",
      type: "erc_missing_gnd",
      message: "Terdapat net daya (VCC/VDD/5V/3V3) tetapi tidak ditemukan net atau pin GND yang terhubung.",
      components: [],
    },
  ]
}
