import { useCallback, useEffect, useState } from "react"
import { api, UNAUTHORIZED_EVENT } from "../lib/api"

interface AuthStatus {
  authRequired: boolean
  authenticated: boolean
}

export interface AuthState {
  status: AuthStatus | null
  error: string | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .get<AuthStatus>("/api/auth/me")
      .then((next) => {
        setStatus(next)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Server tidak bisa dihubungi"))
  }, [])

  useEffect(() => {
    refresh()
    const onUnauthorized = () => setStatus((current) => (current ? { ...current, authenticated: false } : current))
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [refresh])

  const login = useCallback(async (password: string) => {
    await api.post("/api/auth/login", { password })
    setStatus((current) => ({ authRequired: current?.authRequired ?? true, authenticated: true }))
  }, [])

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout")
    setStatus((current) => (current ? { ...current, authenticated: false } : current))
  }, [])

  return { status, error, login, logout }
}
