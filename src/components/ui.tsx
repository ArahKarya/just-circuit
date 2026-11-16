import { X } from "lucide-react"
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react"

type ButtonVariant = "primary" | "ghost" | "danger"

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 font-medium",
  ghost: "text-ink hover:bg-raised border border-line",
  danger: "text-danger hover:bg-danger/10 border border-danger/40",
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = "ghost", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
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
      className={`inline-flex size-9 items-center justify-center rounded-md text-muted transition hover:bg-raised hover:text-ink disabled:opacity-40 ${className}`}
      {...props}
    />
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function Field({ label, hint, id, className = "", ...props }: FieldProps) {
  const inputId = id ?? `field-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <label htmlFor={inputId} className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        id={inputId}
        className={`h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none ${className}`}
        {...props}
      />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    // Above runframe's viewer toolbars, which use very high z-indexes.
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full flex-col rounded-xl border border-line bg-panel shadow-2xl ${wide ? "max-w-4xl" : "max-w-lg"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Tutup" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export const SELECT_CLASS = "h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none"

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly { value: string; label: string }[]
}

export function SelectField({ label, options, id, className = "", ...props }: SelectFieldProps) {
  const selectId = id ?? `select-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <label htmlFor={selectId} className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select id={selectId} className={`${SELECT_CLASS} ${className}`} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
