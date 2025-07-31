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
  const [lastValue, setLastValue] = useState("")

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    const updateCursorPosition = () => {
      if (!input || !isFocused) {
        setCursorPosition(0)
        return
      }

      let selectionStart = input.selectionStart || 0

      // Fallback for email inputs that don't report cursor position correctly
      if (selectionStart === 0 && input.value.length > 0) {
        // If selectionStart is 0 but we have content, assume cursor is at the end
        // This is a common issue with email inputs
        selectionStart = input.value.length
        console.log(`FALLBACK - Using value length: ${selectionStart}`)
      }

      // Simple character-based calculation
      const charWidth = 8.4
      const calculatedPosition = selectionStart * charWidth

      console.log(
        `CURSOR UPDATE - Type: ${input.type}, Reported Position: ${input.selectionStart}, Used Position: ${selectionStart}, Value Length: ${input.value.length}, Calculated: ${calculatedPosition}px`,
      )

      setCursorPosition(calculatedPosition)
      setLastValue(input.value)
    }

    const handleFocus = () => {
      console.log(`FOCUS - Input type: ${input.type}`)
      setIsFocused(true)
      setTimeout(updateCursorPosition, 10)
    }

    const handleBlur = () => {
      console.log(`BLUR - Input type: ${input.type}`)
      setIsFocused(false)
      setCursorPosition(0)
    }

    const handleInput = () => {
      console.log(`INPUT - Type: ${input.type}, Value: "${input.value}"`)
      setTimeout(updateCursorPosition, 10)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      console.log(`KEYUP - Key: ${e.key}, Type: ${input.type}`)
      setTimeout(updateCursorPosition, 10)
    }

    const handleClick = () => {
      console.log(`CLICK - Type: ${input.type}`)
      setTimeout(updateCursorPosition, 20)
    }

    // Add event listeners
    input.addEventListener("focus", handleFocus)
    input.addEventListener("blur", handleBlur)
    input.addEventListener("input", handleInput)
    input.addEventListener("keyup", handleKeyUp)
    input.addEventListener("click", handleClick)

    return () => {
      input.removeEventListener("focus", handleFocus)
      input.removeEventListener("blur", handleBlur)
      input.removeEventListener("input", handleInput)
      input.removeEventListener("keyup", handleKeyUp)
      input.removeEventListener("click", handleClick)
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
          fontFamily: '"Courier New", monospace',
          fontSize: "14px",
        }}
        {...props}
      />
      {isFocused && (
        <div
          className="absolute pointer-events-none select-none"
          style={{
            left: `${8 + cursorPosition}px`, // 8px for padding
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 10,
          }}
        >
          <span className="text-green-400 bg-green-400 inline-block w-2 h-4 animate-pulse">█</span>
        </div>
      )}
    </div>
  )
})

TerminalInput.displayName = "TerminalInput"
