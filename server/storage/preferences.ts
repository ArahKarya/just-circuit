import path from "node:path"
import { z } from "zod"
import { readJsonFile, writeJsonFile } from "./fs-utils.js"

/** How the app looks and behaves (no secrets). */
export const preferencesSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  editor: z
    .object({
      fontSize: z.number().int().min(10).max(24).default(13),
      tabSize: z.union([z.literal(2), z.literal(4)]).default(2),
      wordWrap: z.boolean().default(true),
      minimap: z.boolean().default(false),
      lineNumbers: z.boolean().default(true),
    })
    .default({}),
  preview: z
    .object({
      debounceMs: z.number().int().min(200).max(5000).default(700),
      defaultTab: z.enum(["pcb", "schematic", "cad", "bom"]).default("pcb"),
    })
    .default({}),
})

export type Preferences = z.infer<typeof preferencesSchema>

export function createPreferencesStore(dataDir: string) {
  const file = path.join(dataDir, "preferences.json")

  async function read(): Promise<Preferences> {
    const parsed = preferencesSchema.safeParse(await readJsonFile<unknown>(file, {}))
    return parsed.success ? parsed.data : preferencesSchema.parse({})
  }

  async function write(next: Preferences): Promise<Preferences> {
    await writeJsonFile(file, next)
    return next
  }

  return { read, write }
}

export type PreferencesStore = ReturnType<typeof createPreferencesStore>
