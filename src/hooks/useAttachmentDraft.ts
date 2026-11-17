import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { kindFromName, MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentKind } from "../../shared/attachments"
import { prepareFile } from "../lib/attachments"
import { attachmentsRepo } from "../lib/repo"
import type { AttachmentRef } from "../lib/types"

export interface DraftAttachment {
  key: string
  name: string
  kind: AttachmentKind
  /** Local preview for images (object URL). */
  previewUrl?: string
  status: "uploading" | "ready" | "error"
  ref?: AttachmentRef
  error?: string
}

export interface AttachmentDraft {
  items: DraftAttachment[]
  isUploading: boolean
  add: (files: readonly File[]) => void
  remove: (key: string) => void
  /** Attachments ready to send; clears the draft (the uploads now belong to the message). */
  take: () => AttachmentRef[]
}

/** Files attached to the message being written; each one uploads as soon as it is added. */
export function useAttachmentDraft(projectId: string | undefined): AttachmentDraft {
  const [items, setItems] = useState<DraftAttachment[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const controllers = useRef(new Map<string, AbortController>())

  const patch = useCallback((key: string, change: Partial<DraftAttachment>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)))
  }, [])

  const discard = useCallback((list: readonly DraftAttachment[], deleteUploads: boolean) => {
    for (const item of list) {
      controllers.current.get(item.key)?.abort()
      controllers.current.delete(item.key)
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      if (deleteUploads && projectId && item.ref) void attachmentsRepo.remove(projectId, item.ref.id).catch(() => undefined)
    }
  }, [projectId])

  // Uploads belong to one project: switching project drops the draft.
  useEffect(() => {
    return () => {
      discard(itemsRef.current, true)
      setItems([])
    }
  }, [projectId, discard])

  const upload = useCallback(
    async (key: string, file: File) => {
      if (!projectId) return
      const controller = new AbortController()
      controllers.current.set(key, controller)
      try {
        const prepared = await prepareFile(file)
        const ref = await attachmentsRepo.upload(projectId, prepared.blob, prepared.name, controller.signal)
        if (controller.signal.aborted) {
          // Removed while it was uploading: don't leave it on the server.
          void attachmentsRepo.remove(projectId, ref.id).catch(() => undefined)
          return
        }
        patch(key, { status: "ready", ref, name: ref.name })
      } catch (error) {
        if (controller.signal.aborted) return
        patch(key, { status: "error", error: error instanceof Error ? error.message : "Gagal mengunggah" })
      } finally {
        controllers.current.delete(key)
      }
    },
    [projectId, patch],
  )

  const add = useCallback(
    (files: readonly File[]) => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - itemsRef.current.length
      if (files.length > room) toast.error(`Maksimal ${MAX_ATTACHMENTS_PER_MESSAGE} lampiran per pesan`)
      const accepted = files.slice(0, Math.max(0, room))
      const added: DraftAttachment[] = []
      for (const file of accepted) {
        const kind = kindFromName(file.name)
        if (!kind) {
          toast.error(`"${file.name}" tidak didukung. Pakai gambar, PDF, atau file teks.`)
          continue
        }
        const key = crypto.randomUUID()
        added.push({ key, name: file.name, kind, status: "uploading", ...(kind === "image" ? { previewUrl: URL.createObjectURL(file) } : {}) })
        void upload(key, file)
      }
      if (added.length > 0) setItems((current) => [...current, ...added])
    },
    [upload],
  )

  const remove = useCallback(
    (key: string) => {
      discard(itemsRef.current.filter((item) => item.key === key), true)
      setItems((current) => current.filter((item) => item.key !== key))
    },
    [discard],
  )

  const take = useCallback(() => {
    const ready = itemsRef.current.flatMap((item) => (item.status === "ready" && item.ref ? [item.ref] : []))
    discard(itemsRef.current.filter((item) => item.status !== "ready"), true)
    discard(itemsRef.current.filter((item) => item.status === "ready"), false)
    setItems([])
    return ready
  }, [discard])

  return { items, isUploading: items.some((item) => item.status === "uploading"), add, remove, take }
}
