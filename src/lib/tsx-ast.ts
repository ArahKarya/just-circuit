import type { ProjectFiles } from "./types"

/**
 * Lightweight, formatting-preserving TSX JSX parser and patcher.
 * Enables bidirectional sync between interactive visual editors (Schematic/PCB)
 * and TSX source code without pulling the full TypeScript compiler into the browser.
 */

export type ParsedAttrValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number; unit?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "expression"; raw: string }

export interface JsxAttrNode {
  name: string
  start: number
  end: number
  valueStart: number | null
  valueEnd: number | null
  rawValue: string | null
  parsed: ParsedAttrValue
}

export interface JsxElementNode {
  tagName: string
  start: number
  end: number
  openStart: number
  openEnd: number
  closeStart: number | null
  closeEnd: number | null
  selfClosing: boolean
  attributes: JsxAttrNode[]
}

export type PropPatchValue = string | number | boolean | null | undefined

export interface PcbRoutePoint {
  x: number
  y: number
  layer?: string
  width?: number
  via?: boolean
}

function isIdentStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$"
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === "-" || ch === "."
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
}

/** Skips a quoted string literal starting at `pos`; returns index after closing quote. */
function skipString(src: string, pos: number): number {
  const quote = src[pos]
  let i = pos + 1
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2
      continue
    }
    if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
      i = skipBraces(src, i + 1)
      continue
    }
    if (src[i] === quote) return i + 1
    i += 1
  }
  return src.length
}

/** Skips a balanced `{ ... }` expression starting at `pos`; returns index after closing `}`. */
function skipBraces(src: string, pos: number): number {
  let depth = 0
  let i = pos
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i)
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2)
      i = nl === -1 ? src.length : nl + 1
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2)
      i = end === -1 ? src.length : end + 2
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return src.length
}

function parseAttrValue(raw: string | null): ParsedAttrValue {
  if (raw === null) return { kind: "boolean", value: true }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    const inner = raw.slice(1, -1)
    const numMatch = inner.trim().match(/^(-?\d+(?:\.\d+)?)(mm|deg)?$/)
    if (numMatch) {
      return { kind: "number", value: Number(numMatch[1]), ...(numMatch[2] ? { unit: numMatch[2] } : {}) }
    }
    return { kind: "string", value: inner }
  }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    const inner = raw.slice(1, -1).trim()
    if (inner === "true") return { kind: "boolean", value: true }
    if (inner === "false") return { kind: "boolean", value: false }
    if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith("`") && inner.endsWith("`") && !inner.includes("${"))) {
      return { kind: "string", value: inner.slice(1, -1) }
    }
    const numMatch = inner.match(/^(-?\d+(?:\.\d+)?)$/)
    if (numMatch) return { kind: "number", value: Number(numMatch[1]) }
    return { kind: "expression", raw: inner }
  }
  return { kind: "expression", raw }
}

/** True when `<` at `pos` looks like the start of a JSX tag rather than a `<` comparison or TS generic. */
function looksLikeJsxTag(src: string, pos: number): boolean {
  const next = src[pos + 1]
  if (!next || !isIdentStart(next)) return false
  // Look back past whitespace: if preceded by an identifier or `)` or `]`, it's likely a generic or comparison.
  let j = pos - 1
  while (j >= 0 && isSpace(src[j])) j -= 1
  if (j < 0) return true
  const prev = src[j]
  if (prev === ")" || prev === "]" || prev === '"' || prev === "'" || prev === "`") return false
  if ((prev >= "0" && prev <= "9")) return false
  // Keywords like `return <board>` are valid JSX.
  if (isIdentStart(prev)) {
    let k = j
    while (k >= 0 && (isIdentStart(src[k]) || (src[k] >= "0" && src[k] <= "9"))) k -= 1
    const word = src.slice(k + 1, j + 1)
    return word === "return" || word === "case" || word === "else" || word === "yield" || word === "await" || word === "default"
  }
  return true
}

/** Parses an opening JSX tag starting at `<` (`pos`). Returns null if syntax doesn't match a valid JSX tag. */
function parseOpeningTag(src: string, pos: number): Omit<JsxElementNode, "end" | "closeStart" | "closeEnd"> | null {
  let i = pos + 1
  if (i >= src.length || !isIdentStart(src[i])) return null
  const nameStart = i
  while (i < src.length && isIdentChar(src[i])) i += 1
  const tagName = src.slice(nameStart, i)
  const attributes: JsxAttrNode[] = []

  while (i < src.length) {
    while (i < src.length && isSpace(src[i])) i += 1
    if (i >= src.length) return null
    if (src[i] === "/" && src[i + 1] === ">") {
      return { tagName, start: pos, openStart: pos, openEnd: i + 2, selfClosing: true, attributes }
    }
    if (src[i] === ">") {
      return { tagName, start: pos, openStart: pos, openEnd: i + 1, selfClosing: false, attributes }
    }
    // Spread attribute `{...props}`
    if (src[i] === "{") {
      i = skipBraces(src, i)
      continue
    }
    if (!isIdentStart(src[i])) return null
    const attrStart = i
    while (i < src.length && isIdentChar(src[i])) i += 1
    const attrName = src.slice(attrStart, i)
    let j = i
    while (j < src.length && isSpace(src[j])) j += 1
    if (src[j] !== "=") {
      attributes.push({
        name: attrName,
        start: attrStart,
        end: i,
        valueStart: null,
        valueEnd: null,
        rawValue: null,
        parsed: { kind: "boolean", value: true },
      })
      i = j
      continue
    }
    j += 1
    while (j < src.length && isSpace(src[j])) j += 1
    if (j >= src.length) return null
    const valueStart = j
    if (src[j] === '"' || src[j] === "'") {
      j = skipString(src, j)
    } else if (src[j] === "{") {
      j = skipBraces(src, j)
    } else {
      return null
    }
    const rawValue = src.slice(valueStart, j)
    attributes.push({
      name: attrName,
      start: attrStart,
      end: j,
      valueStart,
      valueEnd: j,
      rawValue,
      parsed: parseAttrValue(rawValue),
    })
    i = j
  }
  return null
}

/** Parses all JSX elements in a TSX/JSX source string with exact character offsets. */
export function parseJsxElements(source: string): JsxElementNode[] {
  const results: JsxElementNode[] = []
  const stack: JsxElementNode[] = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i + 2)
      i = nl === -1 ? source.length : nl + 1
      continue
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i)
      continue
    }
    // Closing tag `</tagName>`
    if (ch === "<" && source[i + 1] === "/") {
      let j = i + 2
      while (j < source.length && isSpace(source[j])) j += 1
      const nameStart = j
      while (j < source.length && isIdentChar(source[j])) j += 1
      const closeName = source.slice(nameStart, j)
      while (j < source.length && isSpace(source[j])) j += 1
      if (source[j] === ">") {
        const closeEnd = j + 1
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s].tagName === closeName) {
            const open = stack.splice(s, 1)[0]
            open.closeStart = i
            open.closeEnd = closeEnd
            open.end = closeEnd
            break
          }
        }
        i = closeEnd
        continue
      }
    }
    if (ch === "<" && looksLikeJsxTag(source, i)) {
      const open = parseOpeningTag(source, i)
      if (open) {
        const node: JsxElementNode = {
          ...open,
          end: open.openEnd,
          closeStart: null,
          closeEnd: null,
        }
        results.push(node)
        if (!open.selfClosing) stack.push(node)
        i = open.openEnd
        continue
      }
    }
    i += 1
  }

  return results
}

export function getAttr(element: JsxElementNode, name: string): JsxAttrNode | undefined {
  return element.attributes.find((attr) => attr.name === name)
}

export function getStringAttr(element: JsxElementNode, name: string): string | undefined {
  const attr = getAttr(element, name)
  if (!attr) return undefined
  if (attr.parsed.kind === "string") return attr.parsed.value
  if (attr.parsed.kind === "number" && attr.rawValue && (attr.rawValue.startsWith('"') || attr.rawValue.startsWith("'"))) {
    return attr.rawValue.slice(1, -1)
  }
  return undefined
}

export function getNumericAttr(element: JsxElementNode, name: string): { kind: "absent" } | { kind: "number"; value: number; unit?: string } | { kind: "unsupported" } {
  const attr = getAttr(element, name)
  if (!attr) return { kind: "absent" }
  if (attr.parsed.kind === "number") return { kind: "number", value: attr.parsed.value, unit: attr.parsed.unit }
  return { kind: "unsupported" }
}

export function roundMm(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

function formatPropValue(name: string, value: string | number | boolean): string {
  if (typeof value === "number") return `${name}={${roundMm(value)}}`
  if (typeof value === "boolean") return value ? name : `${name}={false}`
  return `${name}=${JSON.stringify(value)}`
}

export interface ComponentSummary {
  path: string
  tagName: string
  name: string
  element: JsxElementNode
  pcbX?: number
  pcbY?: number
  pcbRotation?: number
  schX?: number
  schY?: number
  schRotation?: number
  layer?: string
  footprint?: string
  value?: string
  manufacturerPartNumber?: string
}

const VALUE_PROPS = ["resistance", "capacitance", "inductance", "frequency", "color"] as const

function summarize(path: string, element: JsxElementNode): ComponentSummary | null {
  const name = getStringAttr(element, "name")
  if (!name) return null
  if (element.tagName === "board" || element.tagName === "group" || element.tagName === "subcircuit") return null
  const num = (attr: string) => {
    const v = getNumericAttr(element, attr)
    return v.kind === "number" ? v.value : undefined
  }
  const valueProp = VALUE_PROPS.map((prop) => getStringAttr(element, prop)).find(Boolean)
  return {
    path,
    tagName: element.tagName,
    name,
    element,
    pcbX: num("pcbX"),
    pcbY: num("pcbY"),
    pcbRotation: num("pcbRotation"),
    schX: num("schX"),
    schY: num("schY"),
    schRotation: num("schRotation"),
    layer: getStringAttr(element, "layer"),
    footprint: getStringAttr(element, "footprint"),
    value: valueProp,
    manufacturerPartNumber: getStringAttr(element, "manufacturerPartNumber"),
  }
}

/** Lists all named tscircuit components across TSX/JSX files in the project. */
export function listComponents(files: ProjectFiles): ComponentSummary[] {
  const list: ComponentSummary[] = []
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue
    for (const el of parseJsxElements(source)) {
      const summary = summarize(path, el)
      if (summary) list.push(summary)
    }
  }
  return list
}

/** Finds a single component by its `name` prop across TSX/JSX files. */
export function inspectComponent(files: ProjectFiles, name: string): ComponentSummary | null {
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue
    for (const el of parseJsxElements(source)) {
      if (getStringAttr(el, "name") === name) {
        return summarize(path, el) ?? { path, tagName: el.tagName, name, element: el }
      }
    }
  }
  return null
}

export type PatchResult =
  | { status: "updated"; files: ProjectFiles; path: string }
  | { status: "not-found" }
  | { status: "unsupported"; path: string; prop: string }

/** Applies prop additions, updates, or deletions (`undefined`/`null`) to an element's opening tag. */
export function patchElementProps(
  source: string,
  element: JsxElementNode,
  patch: Record<string, PropPatchValue>,
  options?: { force?: boolean },
): { status: "updated"; source: string } | { status: "unsupported"; prop: string } {
  const edits: { start: number; end: number; text: string }[] = []
  const additions: string[] = []

  for (const [prop, nextValue] of Object.entries(patch)) {
    const existing = getAttr(element, prop)
    if (nextValue === undefined || nextValue === null) {
      if (existing) {
        // Also eat one preceding space when deleting an attribute.
        const start = existing.start > element.openStart && source[existing.start - 1] === " " ? existing.start - 1 : existing.start
        edits.push({ start, end: existing.end, text: "" })
      }
      continue
    }
    if (existing) {
      if (existing.parsed.kind === "expression" && !options?.force) {
        return { status: "unsupported", prop }
      }
      edits.push({ start: existing.start, end: existing.end, text: formatPropValue(prop, nextValue) })
    } else {
      additions.push(formatPropValue(prop, nextValue))
    }
  }

  if (additions.length > 0) {
    const closeTokenLen = element.selfClosing ? 2 : 1
    const insertPos = element.openEnd - closeTokenLen
    const needsLeadingSpace = insertPos > element.openStart && !isSpace(source[insertPos - 1])
    const needsTrailingSpace = element.selfClosing && source[insertPos] === "/"
    const prefix = needsLeadingSpace ? " " : ""
    const suffix = needsTrailingSpace ? " " : ""
    edits.push({ start: insertPos, end: insertPos, text: `${prefix}${additions.join(" ")}${suffix}` })
  }

  // Apply edits from end to start so earlier offsets remain valid.
  edits.sort((a, b) => b.start - a.start)
  let next = source
  for (const edit of edits) {
    next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`
  }
  return { status: "updated", source: next }
}

/** Patches props on a named component anywhere in the project. */
export function patchComponentProps(
  files: ProjectFiles,
  name: string,
  patch: Record<string, PropPatchValue>,
  options?: { force?: boolean },
): PatchResult {
  const found = inspectComponent(files, name)
  if (!found) return { status: "not-found" }
  const result = patchElementProps(files[found.path], found.element, patch, options)
  if (result.status === "unsupported") return { status: "unsupported", path: found.path, prop: result.prop }
  return { status: "updated", files: { ...files, [found.path]: result.source }, path: found.path }
}

/** Finds the root `<board>` element in the entrypoint file. */
export function findBoardElement(files: ProjectFiles, entrypoint: string): JsxElementNode | null {
  const source = files[entrypoint]
  if (!source) return null
  return parseJsxElements(source).find((el) => el.tagName === "board") ?? null
}

/** Patches props on the root `<board>` element (e.g. width, height, layers). */
export function patchBoardProps(
  files: ProjectFiles,
  entrypoint: string,
  patch: Record<string, PropPatchValue>,
  options?: { force?: boolean },
): PatchResult {
  const board = findBoardElement(files, entrypoint)
  if (!board) return { status: "not-found" }
  const result = patchElementProps(files[entrypoint], board, patch, options)
  if (result.status === "unsupported") return { status: "unsupported", path: entrypoint, prop: result.prop }
  return { status: "updated", files: { ...files, [entrypoint]: result.source }, path: entrypoint }
}

/** Detects indentation of the line containing `offset` and adds two spaces for child elements. */
function childIndent(source: string, closeStart: number): string {
  const lineStart = source.lastIndexOf("\n", closeStart) + 1
  const match = source.slice(lineStart, closeStart).match(/^[ \t]*/)
  return `${match?.[0] ?? ""}  `
}

/** Inserts a JSX snippet cleanly inside the entrypoint's `<board>...</board>`. */
export function insertIntoBoard(files: ProjectFiles, entrypoint: string, jsxSnippet: string): PatchResult {
  const source = files[entrypoint]
  if (!source) return { status: "not-found" }
  const board = findBoardElement(files, entrypoint)
  if (!board) return { status: "not-found" }

  if (board.selfClosing) {
    const opening = source.slice(board.openStart, board.openEnd - 2).trimEnd()
    const lineStart = source.lastIndexOf("\n", board.openStart) + 1
    const baseIndent = source.slice(lineStart, board.openStart).match(/^[ \t]*/)?.[0] ?? ""
    const indented = jsxSnippet
      .trim()
      .split("\n")
      .map((line) => `${baseIndent}  ${line}`)
      .join("\n")
    const replacement = `${opening}>\n${indented}\n${baseIndent}</board>`
    const next = `${source.slice(0, board.start)}${replacement}${source.slice(board.end)}`
    return { status: "updated", files: { ...files, [entrypoint]: next }, path: entrypoint }
  }

  if (board.closeStart === null) return { status: "not-found" }
  const indent = childIndent(source, board.closeStart)
  const indented = jsxSnippet
    .trim()
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n")
  const lineStart = source.lastIndexOf("\n", board.closeStart) + 1
  const beforeClose = source.slice(lineStart, board.closeStart)
  const insertPos = beforeClose.trim() === "" ? lineStart : board.closeStart
  const prefix = insertPos > 0 && source[insertPos - 1] !== "\n" ? "\n" : ""
  const next = `${source.slice(0, insertPos)}${prefix}${indented}\n${source.slice(insertPos)}`
  return { status: "updated", files: { ...files, [entrypoint]: next }, path: entrypoint }
}

/** Removes a JSX element (including its whole line if nothing else sits on it). */
function removeElementSpan(source: string, element: JsxElementNode): string {
  let start = element.start
  let end = element.end
  const lineStart = source.lastIndexOf("\n", start - 1) + 1
  const lineEndIdx = source.indexOf("\n", end)
  const lineEnd = lineEndIdx === -1 ? source.length : lineEndIdx + 1
  if (source.slice(lineStart, start).trim() === "" && source.slice(end, lineEnd).trim() === "") {
    start = lineStart
    end = lineEnd
  }
  return `${source.slice(0, start)}${source.slice(end)}`
}

/** Deletes a named component and optionally any `<trace>` referencing it. */
export function deleteComponent(files: ProjectFiles, name: string, options?: { removeConnectedTraces?: boolean }): PatchResult {
  const found = inspectComponent(files, name)
  if (!found) return { status: "not-found" }

  const nextFiles: Record<string, string> = { ...files }
  nextFiles[found.path] = removeElementSpan(nextFiles[found.path], found.element)

  if (options?.removeConnectedTraces) {
    const refPattern = new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|\\s|>|$)`)
    for (const [path, source] of Object.entries(nextFiles)) {
      if (!/\.(tsx|jsx)$/.test(path)) continue
      const traces = parseJsxElements(source).filter((el) => {
        if (el.tagName !== "trace") return false
        const from = getStringAttr(el, "from") ?? ""
        const to = getStringAttr(el, "to") ?? ""
        return refPattern.test(from) || refPattern.test(to)
      })
      if (traces.length === 0) continue
      let updated = source
      for (const trace of traces.sort((a, b) => b.start - a.start)) {
        updated = removeElementSpan(updated, trace)
      }
      nextFiles[path] = updated
    }
  }

  return { status: "updated", files: nextFiles, path: found.path }
}

/** Inserts a `<trace from="..." to="..." />` into `<board>`. */
export function addTrace(
  files: ProjectFiles,
  entrypoint: string,
  from: string,
  to: string,
  extraProps?: Record<string, PropPatchValue>,
): PatchResult {
  const attrs = [`from=${JSON.stringify(from)}`, `to=${JSON.stringify(to)}`]
  if (extraProps) {
    for (const [key, val] of Object.entries(extraProps)) {
      if (val !== undefined && val !== null) attrs.push(formatPropValue(key, val))
    }
  }
  return insertIntoBoard(files, entrypoint, `<trace ${attrs.join(" ")} />`)
}

/** Inserts a raw manual copper `<pcbtrace route={[...]} />` into `<board>`. */
export function addPcbTrace(
  files: ProjectFiles,
  entrypoint: string,
  route: readonly PcbRoutePoint[],
  options?: { layer?: string; width?: number; net?: string },
): PatchResult {
  if (route.length < 2) return { status: "not-found" }
  const defaultLayer = options?.layer ?? "top"
  const defaultWidth = options?.width ?? 0.2
  const points = route.map((pt) => {
    if (pt.via) {
      return `{ route_type: "via", x: ${roundMm(pt.x)}, y: ${roundMm(pt.y)}, from_layer: ${JSON.stringify(defaultLayer)}, to_layer: ${JSON.stringify(pt.layer ?? "bottom")} }`
    }
    return `{ route_type: "wire", x: ${roundMm(pt.x)}, y: ${roundMm(pt.y)}, width: ${roundMm(pt.width ?? defaultWidth)}, layer: ${JSON.stringify(pt.layer ?? defaultLayer)} }`
  })
  const attrs = [`route={[${points.join(", ")}]}`]
  if (options?.net) attrs.push(`net=${JSON.stringify(options.net)}`)
  return insertIntoBoard(files, entrypoint, `<pcbtrace ${attrs.join(" ")} />`)
}

/** Inserts a manual `<via />` into `<board>`. */
export function addVia(
  files: ProjectFiles,
  entrypoint: string,
  x: number,
  y: number,
  options?: { fromLayer?: string; toLayer?: string; holeDiameter?: string; outerDiameter?: string; net?: string },
): PatchResult {
  const attrs = [
    `pcbX={${roundMm(x)}}`,
    `pcbY={${roundMm(y)}}`,
    `fromLayer=${JSON.stringify(options?.fromLayer ?? "top")}`,
    `toLayer=${JSON.stringify(options?.toLayer ?? "bottom")}`,
  ]
  if (options?.holeDiameter) attrs.push(`holeDiameter=${JSON.stringify(options.holeDiameter)}`)
  if (options?.outerDiameter) attrs.push(`outerDiameter=${JSON.stringify(options.outerDiameter)}`)
  if (options?.net) attrs.push(`net=${JSON.stringify(options.net)}`)
  return insertIntoBoard(files, entrypoint, `<via ${attrs.join(" ")} />`)
}
