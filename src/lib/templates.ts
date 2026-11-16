import blank from "../../templates/blank.circuit.tsx?raw"
import pico from "../../templates/pico.circuit.tsx?raw"
import regulator from "../../templates/regulator-3v3.circuit.tsx?raw"
import { DEFAULT_ENTRYPOINT, STARTER_CODE } from "./project-ops"
import type { ProjectFiles } from "./types"

export interface ProjectTemplate {
  id: string
  label: string
  description: string
  files: ProjectFiles
}

/** Starting points for new projects; each was checked with `tsci build` (see templates/README.md). */
export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  { id: "led", label: "LED + resistor", description: "Contoh kecil: header 2 pin, resistor 330Ω, LED.", files: { [DEFAULT_ENTRYPOINT]: STARTER_CODE } },
  { id: "blank", label: "Kosong", description: "Board 30×20 mm tanpa komponen.", files: { [DEFAULT_ENTRYPOINT]: blank } },
  {
    id: "pico",
    label: "Raspberry Pi Pico",
    description: "Modul Pico (DIP-40, pinout lengkap), LED status di GP15, tombol reset di RUN.",
    files: { [DEFAULT_ENTRYPOINT]: pico },
  },
  {
    id: "regulator-3v3",
    label: "Catu daya 3.3V (AMS1117)",
    description: "Input VIN/GND, AMS1117-3.3, kapasitor input/output, LED power, header output 3.3V.",
    files: { [DEFAULT_ENTRYPOINT]: regulator },
  },
]

export const DEFAULT_TEMPLATE_ID = "led"

export function findTemplate(id: string): ProjectTemplate {
  return PROJECT_TEMPLATES.find((t) => t.id === id) ?? PROJECT_TEMPLATES[0]
}
