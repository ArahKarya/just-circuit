/** Thin client for the CDS server. Every call carries the CSRF header the server requires. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export const UNAUTHORIZED_EVENT = "cds:unauthorized"

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

export async function apiRequest<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method,
    signal,
    credentials: "same-origin",
    headers: { "X-CDS-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let envelope: Envelope<T> | null = null
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    // Non-JSON error page (e.g. proxy); fall through to the status text.
  }
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  if (!response.ok || !envelope?.success) {
    throw new ApiError(envelope?.error ?? `Server error (HTTP ${response.status})`, response.status)
  }
  return envelope.data as T
}

export const api = {
  get: <T>(url: string) => apiRequest<T>("GET", url),
  post: <T>(url: string, body?: unknown) => apiRequest<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => apiRequest<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown) => apiRequest<T>("PATCH", url, body),
  delete: <T>(url: string) => apiRequest<T>("DELETE", url),
}
