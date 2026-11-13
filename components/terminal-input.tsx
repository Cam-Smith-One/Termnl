"use client"

import { forwardRef, type InputHTMLAttributes } from "react"

// Native selection and caret support passwords, email, autofill and mobile input.
// Never log input events: these fields also contain account passwords.
export const TerminalInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", style, ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full bg-black border border-green-400 text-green-400 font-mono focus:border-green-300 focus:outline-none focus:ring-1 focus:ring-green-300 p-2 ${className}`}
      style={{ caretColor: "#4ade80", fontFamily: '"Courier New", monospace', fontSize: "16px", ...style }}
      {...props}
    />
  ),
)
TerminalInput.displayName = "TerminalInput"
