const MAX_SLUG_LENGTH = 80

/** A lowercase, path-free name that is safe to use as a download file name. */
export function safeFileSlug(raw: string, fallback = "board"): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "")
  return slug || fallback
}
