import { stripCodeBlocks } from "./extract-code"
import type { ChatTurn } from "./llm-client"
import type { ChatMessage } from "./types"

export const HISTORY_LIMIT = 16

/**
 * Builds the conversation sent to the model. Code in earlier assistant replies is
 * replaced by a marker: the system prompt already holds the latest file contents,
 * so repeating old versions only wastes tokens and confuses edits.
 */
export function toTurns(messages: readonly ChatMessage[], limit: number = HISTORY_LIMIT): ChatTurn[] {
  return messages
    .filter((m) => !m.isError)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.role === "assistant" ? stripCodeBlocks(m.content).trim() || "(kode diterapkan)" : m.content }))
}
