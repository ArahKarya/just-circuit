import { X } from "lucide-react"
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react"

type ButtonVariant = "primary" | "ghost" | "danger" | "subtle"
type ButtonSize = "sm" | "md"

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 font-medium shadow-sm shadow-accent/20",
  ghost: "text-ink bg-panel/60 hover:bg-raised border border-line",
  subtle: "text-muted hover:bg-raised hover:text-ink border border-transparent",
  danger: "text-danger bg-danger/5 hover:bg-danger/15 border border-danger/35",
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-7 px-2.5 text-xs rounded-md gap-1.5",
  md: "min-h-9 px-3 text-sm rounded-lg gap-1.5",
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = "ghost", size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center whitespace-nowrap transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 ${BUTTON_SIZES[size]} ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

export function IconButton({ label, className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-raised hover:text-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${className}`}
      {...props}
    />
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/55 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"

export function Field({ label, hint, id, className = "", ...props }: FieldProps) {
  const inputId = id ?? `field-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <label htmlFor={inputId} className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <input id={inputId} className={`${INPUT_CLASS} ${className}`} {...props} />
      {hint && <span className="block text-[11px] leading-relaxed text-muted">{hint}</span>}
    </label>
  )
}

interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ title, subtitle, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    // Above runframe's viewer toolbars, which use very high z-indexes.
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/50 ${wide ? "max-w-4xl" : "max-w-lg"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/40 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <IconButton label="Tutup" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface/35 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly { value: string; label: string }[]
}

export function SelectField({ label, options, id, className = "", ...props }: SelectFieldProps) {
  const selectId = id ?? `select-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <label htmlFor={selectId} className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <select id={selectId} className={`${SELECT_CLASS} ${className}`} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
