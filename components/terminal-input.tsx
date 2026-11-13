"use client"

import { forwardRef, type InputHTMLAttributes } from "react"

// Native selection and caret support passwords, email, autofill and mobile input.
// Never log input events: these fields also contain account passwords.
export const TerminalInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", style, ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full rounded-md border border-t-line-strong bg-t-field p-2 font-mono text-t-ink caret-t-accent focus:border-t-accent focus:outline-none focus:ring-1 focus:ring-t-accent ${className}`}
      style={{ fontSize: "16px", ...style }}
      {...props}
    />
  ),
)
TerminalInput.displayName = "TerminalInput"
