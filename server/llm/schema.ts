import { z } from "zod"
import { ATTACHMENT_ID, MAX_ATTACHMENTS_PER_MESSAGE } from "../../shared/attachments.js"

export const providerKinds = ["openai-compatible", "anthropic", "gemini"] as const

export const connectionSchema = z.object({
  kind: z.enum(providerKinds),
  baseUrl: z.string().trim().max(500).optional().default(""),
  apiKey: z.string().max(500).optional().default(""),
  model: z.string().trim().max(200).optional().default(""),
})

export const chatRequestSchema = z.object({
  /** Saved connection; its API key is read on the server and never sent by the browser. */
  connectionId: z.string().min(1).max(100),
  // Holds the whole project; a multi-module design like a PLC easily passes 60k characters.
  system: z.string().max(600_000),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(200_000),
        /** Ids of files stored with the project; the server reads and attaches them. */
        attachments: z.array(z.string().regex(ATTACHMENT_ID)).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
      }),
    )
    .min(1)
    .max(100),
  /** Project whose attachments the messages refer to. */
  projectId: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(256).max(64_000).optional(),
  /** Agent mode: the model may read/write project files, build and search parts with tools. */
  agent: z
    .object({
      projectId: z.string().min(1).max(100),
      maxSteps: z.number().int().min(2).max(40),
      /** Version message for the files the agent changes. */
      versionMessage: z.string().trim().min(1).max(200),
      /** The project's build scope: server builds skip the same parts as the preview. */
      schematicDisabled: z.boolean().optional(),
      routingDisabled: z.boolean().optional(),
    })
    .optional(),
})

/** Listing models works for unsaved connections too; an empty apiKey falls back to the saved one. */
export const modelsRequestSchema = z.object({ connection: connectionSchema, connectionId: z.string().max(100).optional() })

export type Connection = z.infer<typeof connectionSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>
