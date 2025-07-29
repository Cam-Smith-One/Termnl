"use client"

import type React from "react"
import { forwardRef, useEffect, useRef, useState } from "react"

interface TerminalInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Add any additional props if needed
}

export const TerminalInput = forwardRef<HTMLInputElement, TerminalInputProps>(({ className = "", ...props }, ref) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    const updateCursorPosition = () => {
      if (!input || !isFocused) {
        setCursorPosition(0)
        return
      }

      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")
      if (!context) return

      // Get computed styles to match the input exactly
      const computedStyle = window.getComputedStyle(input)
      context.font = `${computedStyle.fontSize} ${computedStyle.fontFamily}`

      // Get cursor position and measure text width
      const selectionStart = input.selectionStart || 0
      let textBeforeCursor = input.value.substring(0, selectionStart)

      // For password fields, replace characters with dots for measurement
      if (input.type === "password") {
        textBeforeCursor = "•".repeat(selectionStart)
      }

      const textWidth = context.measureText(textBeforeCursor).width
      setCursorPosition(textWidth)
    }

    const handleFocus = () => {
      setIsFocused(true)
      setTimeout(updateCursorPosition, 10)
    }

    const handleBlur = () => {
      setIsFocused(false)
      setCursorPosition(0)
    }

    const handleInput = () => {
      setTimeout(updateCursorPosition, 10)
    }

    const handleKeyUp = () => {
      setTimeout(updateCursorPosition, 10)
    }

    const handleKeyDown = () => {
      setTimeout(updateCursorPosition, 10)
    }

    const handleClick = () => {
      setTimeout(updateCursorPosition, 10)
    }

    const handleSelectionChange = () => {
      if (document.activeElement === input) {
        setTimeout(updateCursorPosition, 10)
      }
    }

    // Add all event listeners
    input.addEventListener("focus", handleFocus)
    input.addEventListener("blur", handleBlur)
    input.addEventListener("input", handleInput)
    input.addEventListener("keyup", handleKeyUp)
    input.addEventListener("keydown", handleKeyDown)
    input.addEventListener("click", handleClick)
    document.addEventListener("selectionchange", handleSelectionChange)

    return () => {
      input.removeEventListener("focus", handleFocus)
      input.removeEventListener("blur", handleBlur)
      input.removeEventListener("input", handleInput)
      input.removeEventListener("keyup", handleKeyUp)
      input.removeEventListener("keydown", handleKeyDown)
      input.removeEventListener("click", handleClick)
      document.removeEventListener("selectionchange", handleSelectionChange)
    }
  }, [isFocused])

  return (
    <div className="relative w-full">
      <input
        ref={(node) => {
          inputRef.current = node
          if (typeof ref === "function") {
            ref(node)
          } else if (ref) {
            ref.current = node
          }
        }}
        className={`w-full bg-black border border-green-400 text-green-400 font-mono focus:border-green-300 focus:outline-none p-2 ${className}`}
        style={{
          caretColor: "transparent",
          position: "relative",
          zIndex: 1,
        }}
        {...props}
      />
      {isFocused && (
        <div
          className="absolute pointer-events-none select-none"
          style={{
            left: `${8 + cursorPosition}px`, // 8px for input padding
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2,
          }}
        >
          <span
            className="terminal-cursor-block"
            style={{
              color: "#00ff00",
              backgroundColor: "#00ff00",
              display: "inline-block",
              width: "8px",
              height: "14px",
              fontFamily: "Courier New, monospace",
              fontSize: "14px",
            }}
          >
            █
          </span>
        </div>
      )}
    </div>
  )
})

TerminalInput.displayName = "TerminalInput"
