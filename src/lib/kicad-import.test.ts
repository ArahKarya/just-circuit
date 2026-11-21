import { describe, expect, it } from "vitest"
import { assertKicadSymbolFile, circuitJsonToTsx, importKicadFiles, importKicadSymbol, kicadImportNote, MAX_KICAD_FILE_BYTES } from "./kicad-import"
import { getStringAttr, parseJsxElements } from "./tsx-ast"

describe("kicad-import", () => {
  it("generates editable TSX with board, components, copper traces, and vias", () => {
    const circuitJson = [
      { type: "pcb_board", width: 50, height: 30, center: { x: 0, y: 0 } },
      { type: "source_component", source_component_id: "s1", name: "R1", ftype: "simple_resistor", display_resistance: "4.7k" },
      { type: "pcb_component", pcb_component_id: "p1", source_component_id: "s1", center: { x: -5, y: 2 }, width: 2, height: 1, rotation: 90, layer: "top" },
      { type: "schematic_component", schematic_component_id: "sc1", source_component_id: "s1", center: { x: 1, y: 1 }, size: { width: 1, height: 0.5 }, rotation: 0 },
      {
        type: "pcb_trace",
        pcb_trace_id: "t1",
        route: [
          { route_type: "wire", x: -5, y: 2, width: 0.25, layer: "top" },
          { route_type: "wire", x: 5, y: 2, width: 0.25, layer: "top" },
        ],
      },
      { type: "pcb_via", pcb_via_id: "v1", x: 5, y: 2, outer_diameter: 0.6, hole_diameter: 0.3, layers: ["top", "bottom"] },
    ]
    const { tsx, stats } = circuitJsonToTsx(circuitJson)
    expect(stats).toEqual({ components: 1, traces: 1, vias: 1 })
    expect(tsx).toContain('<board width="50mm" height="30mm">')
    expect(tsx).toContain('<resistor name="R1" resistance="4.7k" footprint="0603" pcbX={-5} pcbY={2} pcbRotation={90} schX={1} schY={1} />')
    expect(tsx).toContain('<pcbtrace route={[{ route_type: "wire", x: -5, y: 2, width: 0.25, layer: "top" }')
    expect(tsx).toContain('<via pcbX={5} pcbY={2} fromLayer="top" toLayer="bottom" />')
  })
})

describe("kicad-import hardening", () => {
  const part = (id: string, name: string, extra: Record<string, unknown> = {}) => [
    { type: "source_component", source_component_id: `s${id}`, name, ftype: "simple_resistor", ...extra },
    { type: "pcb_component", pcb_component_id: `p${id}`, source_component_id: `s${id}`, center: { x: Number(id), y: 0 }, width: 2, height: 1, rotation: 0, layer: "top" },
  ]

  it("keeps unannotated and duplicated parts apart, renaming them uniquely", () => {
    const json = [{ type: "pcb_board", width: 20, height: 20 }, ...part("1", "R?"), ...part("2", "R?"), ...part("3", "R1"), ...part("4", "R1")]
    const { tsx, stats, notes } = circuitJsonToTsx(json)
    expect(stats.components).toBe(4)
    const names = [...tsx.matchAll(/name="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(4)
    expect(names).toContain("R1")
    expect(notes.renamed.map((r) => r.from).sort()).toEqual(["R1", "R?", "R?"])
  })

  it("skips KiCad power and flag symbols", () => {
    const json = [{ type: "pcb_board", width: 20, height: 20 }, ...part("1", "#PWR01"), ...part("2", "R1")]
    const { stats, notes } = circuitJsonToTsx(json)
    expect(stats.components).toBe(1)
    expect(notes.skippedSymbols).toBe(1)
  })

  it("never lets a crafted value escape its attribute", () => {
    const json = [
      { type: "pcb_board", width: 20, height: 20 },
      ...part("1", "R1", { display_resistance: '1k" x={alert(1)} y="' }),
      { type: "schematic_component", schematic_component_id: "sc1", source_component_id: "s1", center: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    ]
    const { tsx } = circuitJsonToTsx(json)
    const [el] = parseJsxElements(tsx).filter((e) => e.tagName === "resistor")
    expect(el.attributes.map((a) => a.name)).not.toContain("x")
    expect(getStringAttr(el, "resistance")).toBe('1k" x={alert(1)} y="')
  })

  it("refuses files over the size limit", () => {
    expect(() => importKicadFiles([{ name: "big.kicad_pcb", content: "x".repeat(MAX_KICAD_FILE_BYTES + 1) }])).toThrow(/terlalu besar/)
  })

  it("preserves netlist <trace> connections and <copperpour> zones", () => {
    const json = [
      { type: "pcb_board", width: 30, height: 20 },
      { type: "source_net", source_net_id: "net1", name: "GND" },
      { type: "source_component", source_component_id: "s1", name: "R1", ftype: "simple_resistor" },
      { type: "source_port", source_port_id: "sp1", source_component_id: "s1", name: "pin1" },
      { type: "pcb_component", pcb_component_id: "p1", source_component_id: "s1", center: { x: 0, y: 0 }, width: 2, height: 1, rotation: 0, layer: "top" },
      { type: "source_trace", connected_source_port_ids: ["sp1"], connected_source_net_ids: ["net1"] },
      { type: "pcb_copper_pour", source_net_id: "net1", layer: "bottom" },
    ]
    const { tsx, stats } = circuitJsonToTsx(json)
    expect(stats.netTraces).toBe(1)
    expect(stats.zones).toBe(1)
    expect(tsx).toContain('<trace from=".R1 > .pin1" to="net.GND" />')
    expect(tsx).toContain('<copperpour connectsTo="net.GND" layer="bottom" useThermalReliefs />')
  })
})

describe("kicad-import nets, ports and pours", () => {
  const board = { type: "pcb_board", width: 30, height: 20 }
  const resistor = [
    { type: "source_component", source_component_id: "s1", name: "R1", ftype: "simple_resistor" },
    { type: "pcb_component", pcb_component_id: "p1", source_component_id: "s1", center: { x: 0, y: 0 }, width: 2, height: 1, rotation: 0, layer: "top" },
  ]
  const net = (id: string, name: string) => ({ type: "source_net", source_net_id: id, name })
  const port = (id: string, extra: Record<string, unknown>) => ({ type: "source_port", source_port_id: id, source_component_id: "s1", ...extra })

  it("rewrites KiCad net names into valid, unique tscircuit names instead of dropping them", () => {
    const json = [
      board,
      ...resistor,
      net("n1", "+3V3"),
      net("n2", "/SDA"),
      net("n3", "Net-(R1-Pad1)"),
      port("sp1", { name: "pin1", pin_number: 1 }),
      port("sp2", { name: "pin2", pin_number: 2 }),
      { type: "source_trace", connected_source_port_ids: ["sp1"], connected_source_net_ids: ["n1"] },
      { type: "source_trace", connected_source_port_ids: ["sp2"], connected_source_net_ids: ["n2"] },
      { type: "source_trace", connected_source_port_ids: ["sp1"], connected_source_net_ids: ["n3"] },
    ]
    const { tsx, notes } = circuitJsonToTsx(json)
    expect(tsx).toContain('<trace from=".R1 > .pin1" to="net.P3V3" />')
    expect(tsx).toContain('<trace from=".R1 > .pin2" to="net.SDA" />')
    expect(tsx).toContain('<trace from=".R1 > .pin1" to="net.Net_R1_Pad1" />')
    expect(notes.renamedNets).toBe(3)
    expect(kicadImportNote(notes)).toMatch(/3 nama net disesuaikan/)
  })

  it("selects ports by pin number and counts the ones it cannot select", () => {
    const json = [
      board,
      ...resistor,
      net("n1", "GND"),
      port("sp1", { name: "VCC", pin_number: 3 }),
      port("sp2", { name: "A1", port_hints: ["A1"] }),
      port("sp3", { name: "7" }),
      { type: "source_trace", connected_source_port_ids: ["sp1", "sp2", "sp3"], connected_source_net_ids: ["n1"] },
    ]
    const { tsx, notes } = circuitJsonToTsx(json)
    expect(tsx).toContain('<trace from=".R1 > .pin3" to="net.GND" />')
    expect(tsx).toContain('<trace from=".R1 > .pin7" to="net.GND" />')
    expect(tsx).not.toContain(".A1")
    expect(tsx).not.toContain(".VCC")
    expect(notes.skippedPorts).toBe(1)
  })

  it("skips pours without a net and dedupes pours by net and layer, with no GND fallback", () => {
    const json = [
      board,
      ...resistor,
      net("n1", "+5V"),
      { type: "pcb_copper_pour", source_net_id: "n1", layer: "top" },
      { type: "pcb_copper_pour", source_net_id: "n1", layer: "top" },
      { type: "pcb_copper_pour", source_net_id: "n1", layer: "bottom" },
      { type: "pcb_copper_pour", layer: "bottom" },
      { type: "pcb_copper_pour", source_net_id: "missing", layer: "bottom" },
    ]
    const { tsx, stats, notes } = circuitJsonToTsx(json)
    const pours = parseJsxElements(tsx).filter((e) => e.tagName === "copperpour")
    expect(pours.map((p) => [getStringAttr(p, "connectsTo"), getStringAttr(p, "layer")])).toEqual([
      ["net.P5V", "top"],
      ["net.P5V", "bottom"],
    ])
    expect(stats.zones).toBe(2)
    expect(notes.skippedZones).toBe(3)
    expect(tsx).not.toContain("net.GND")
  })

  it("reports chips that got the stand-in footprint", () => {
    const json = [
      board,
      { type: "source_component", source_component_id: "u", name: "U1", ftype: "simple_chip" },
      { type: "pcb_component", pcb_component_id: "pu", source_component_id: "u", center: { x: 0, y: 0 }, width: 2, height: 2, rotation: 0, layer: "top" },
    ]
    const { notes } = circuitJsonToTsx(json)
    expect(notes.placeholderFootprints).toBe(1)
    expect(kicadImportNote(notes)).toMatch(/footprint sementara/)
  })
})

const pin = (num: number, name: string, y: number) =>
  `(pin passive line (at -5 ${y} 0) (length 2.54) (name "${name}" (effects (font (size 1 1)))) (number "${num}" (effects (font (size 1 1)))))`

const SYMBOL_LIB = `(kicad_symbol_lib (version 20211014) (generator test)
  (symbol "MYCHIP" (in_bom yes) (on_board yes)
    (property "Reference" "U" (id 0) (at 0 0 0))
    (property "Value" "MYCHIP" (id 1) (at 0 0 0))
    (symbol "MYCHIP_0_1"
      ${pin(1, "VCC", 2)}
      ${pin(2, "~", 0)}
      ${pin(3, "GND", -2)}
      ${pin(4, "GND", -4)}
      ${pin(5, "~{RESET}", -6)}
    )
  )
)`

describe("importKicadSymbol", () => {
  it("leaves the footprint empty by default instead of guessing a package", () => {
    const sym = importKicadSymbol("my_chip.kicad_sym", SYMBOL_LIB)
    const [chip] = parseJsxElements(sym.tsx).filter((e) => e.tagName === "chip")
    expect(chip.attributes.map((a) => a.name)).not.toContain("footprint")
    expect(sym.tsx).toMatch(/Footprint belum dipilih/)
  })

  it("uses the footprint the user chose and rejects a malformed one", () => {
    const sym = importKicadSymbol("my_chip.kicad_sym", SYMBOL_LIB, { footprint: "tssop20" })
    const [chip] = parseJsxElements(sym.tsx).filter((e) => e.tagName === "chip")
    expect(getStringAttr(chip, "footprint")).toBe("tssop20")
    expect(() => importKicadSymbol("my_chip.kicad_sym", SYMBOL_LIB, { footprint: 'soic8" x="1' })).toThrow(/tidak valid/)
  })

  it("turns '~' and duplicate pin names into valid unique pin labels", () => {
    const sym = importKicadSymbol("my_chip.kicad_sym", SYMBOL_LIB, { customName: "My Chip" })
    expect(sym.componentName).toBe("MyChip")
    expect(sym.pinCount).toBe(5)
    const labels = [...sym.tsx.matchAll(/pin(\d+): "([^"]+)"/g)].map((m) => [Number(m[1]), m[2]])
    expect(labels).toEqual([
      [1, "VCC"],
      [2, "pin2"],
      [3, "GND"],
      [4, "GND_2"],
      [5, "N_RESET"],
    ])
    expect(sym.renamedPins).toBe(2)
  })
})

describe("assertKicadSymbolFile", () => {
  it("rejects other extensions and oversize files before reading them", () => {
    expect(() => assertKicadSymbolFile({ name: "part.kicad_mod", size: 10 })).toThrow(/bukan file .kicad_sym/)
    expect(() => assertKicadSymbolFile({ name: "part.kicad_sym", size: MAX_KICAD_FILE_BYTES + 1 })).toThrow(/terlalu besar/)
    expect(() => assertKicadSymbolFile({ name: "Part.KICAD_SYM", size: 10 })).not.toThrow()
  })
})
