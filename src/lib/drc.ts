/** Design-rule and electrical-rule problems read from a rendered circuit (DRC/ERC panel). */
export type IssueSeverity = "error" | "warning"
export type IssueCategory = "pcb" | "schematic" | "source" | "build"

export interface DesignIssue {
  key: string
  severity: IssueSeverity
  category: IssueCategory
  /** circuit-json type, e.g. pcb_footprint_overlap_error. */
  type: string
  message: string
  /** Component names involved (R1, U1…), for jumping to the code. */
  components: string[]
}

type Element = Record<string, unknown> & { type?: string }

/** Concerns that don't fail the build (also shown as warnings in the header). */
const SOFT_ERRORS = [/but supplier part .+ matching diode polarity/i]
const NAME_IN_MESSAGE = /(?:^|[\s[(,.<"'])\.?([A-Z]{1,4}\d{1,4}[A-Z]?)(?=\.(?:pin\d+|[A-Za-z_]\w*)\b|[\s,\]):"']|$)/g

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [])

function categoryOf(type: string): IssueCategory {
  if (type.startsWith("pcb_")) return "pcb"
  if (type.startsWith("schematic_")) return "schematic"
  return "source"
}

function buildIndex(elements: readonly Element[]) {
  const sourceName = new Map<string, string>()
  const pcbToSource = new Map<string, string>()
  const portToSource = new Map<string, string>()
  for (const e of elements) {
    if (e.type === "source_component") sourceName.set(String(e.source_component_id), String(e.name))
    else if (e.type === "pcb_component") pcbToSource.set(String(e.pcb_component_id), String(e.source_component_id))
    else if (e.type === "source_port") portToSource.set(String(e.source_port_id), String(e.source_component_id))
  }
  const pcbPortToSource = new Map<string, string>()
  for (const e of elements) {
    if (e.type !== "pcb_port") continue
    const viaPort = portToSource.get(String(e.source_port_id))
    const viaComponent = pcbToSource.get(String(e.pcb_component_id))
    const source = viaPort ?? viaComponent
    if (source) pcbPortToSource.set(String(e.pcb_port_id), source)
  }
  return { sourceName, pcbToSource, portToSource, pcbPortToSource }
}

function componentsOf(e: Element, index: ReturnType<typeof buildIndex>, known: Set<string>): string[] {
  const sourceIds = [
    ...asStrings(e.source_component_ids),
    ...[asString(e.source_component_id)].filter((v): v is string => Boolean(v)),
    ...[...asStrings(e.pcb_component_ids), ...[asString(e.pcb_component_id)].filter((v): v is string => Boolean(v))].map((id) => index.pcbToSource.get(id) ?? ""),
    ...[...asStrings(e.source_port_ids), ...[asString(e.source_port_id)].filter((v): v is string => Boolean(v))].map((id) => index.portToSource.get(id) ?? ""),
    ...asStrings(e.pcb_port_ids).map((id) => index.pcbPortToSource.get(id) ?? ""),
  ]
  const names = sourceIds.map((id) => index.sourceName.get(id)).filter((n): n is string => Boolean(n))
  // Fallback: names mentioned in the message ("C1.pin1", ".R1"), only if they are real components.
  const message = String(e.message ?? "")
  for (const match of message.matchAll(NAME_IN_MESSAGE)) if (known.has(match[1])) names.push(match[1])
  return [...new Set(names)]
}

/** All *_error / *_warning elements of a circuit, errors first. */
export function extractIssues(circuitJson: readonly unknown[]): DesignIssue[] {
  const elements = circuitJson.filter((e): e is Element => Boolean(e) && typeof e === "object")
  const index = buildIndex(elements)
  const known = new Set(index.sourceName.values())
  const issues: DesignIssue[] = []
  elements.forEach((e, i) => {
    const type = e.type ?? ""
    const isError = type.endsWith("_error")
    if (!isError && !type.endsWith("_warning")) return
    const message = String(e.message ?? type)
    const soft = isError && SOFT_ERRORS.some((pattern) => pattern.test(message))
    issues.push({
      key: `${type}:${i}`,
      severity: isError && !soft ? "error" : "warning",
      category: categoryOf(type),
      type,
      message,
      components: componentsOf(e, index, known),
    })
  })
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1))
}

/** Errors without a circuit (syntax errors, crashes) as issues. */
export function buildIssues(messages: readonly string[]): DesignIssue[] {
  return messages.map((message, i) => ({ key: `build:${i}`, severity: "error", category: "build", type: "build_error", message, components: [] }))
}

export interface CodeLocation {
  path: string
  line: number
  column: number
}

/** Where a component is declared: the element with name="R1" (entrypoint searched first). */
export function locateComponent(files: Readonly<Record<string, string>>, entrypoint: string, name: string): CodeLocation | null {
  const pattern = new RegExp(`\\bname\\s*=\\s*(?:["']|\\{\\s*["'])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`)
  const paths = [entrypoint, ...Object.keys(files).filter((p) => p !== entrypoint).sort()]
  for (const path of paths) {
    const lines = (files[path] ?? "").split("\n")
    const line = lines.findIndex((text) => pattern.test(text))
    if (line !== -1) return { path, line: line + 1, column: Math.max(1, lines[line].search(/\S/) + 1) }
  }
  return null
}
