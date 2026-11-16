import { z } from "zod"

export const providerKinds = ["openai-compatible", "anthropic", "gemini"] as const

export const connectionSchema = z.object({
  kind: z.enum(providerKinds),
  baseUrl: z.string().trim().max(500).optional().default(""),
  apiKey: z.string().max(500).optional().default(""),
  model: z.string().trim().max(200).optional().default(""),
})

export const chatRequestSchema = z.object({
  connection: connectionSchema.extend({ model: z.string().trim().min(1, "Model wajib diisi").max(200) }),
  // Holds the whole project; a multi-module design like a PLC easily passes 60k characters.
  system: z.string().max(600_000),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(200_000),
      }),
    )
    .min(1)
    .max(100),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(256).max(64_000).optional(),
})

export const modelsRequestSchema = z.object({ connection: connectionSchema })

export type Connection = z.infer<typeof connectionSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>
