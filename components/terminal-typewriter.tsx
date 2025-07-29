"use client"

import { useState, useEffect } from "react"

interface TerminalTypewriterProps {
  lines: string[]
  speed?: number
  delay?: number
  className?: string
}

export function TerminalTypewriter({ lines, speed = 50, delay = 500, className = "" }: TerminalTypewriterProps) {
  const [displayedLines, setDisplayedLines] = useState<string[]>([])
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const [currentCharIndex, setCurrentCharIndex] = useState(0)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    if (currentLineIndex >= lines.length) {
      setIsComplete(true)
      return
    }

    const currentLine = lines[currentLineIndex]

    if (currentCharIndex < currentLine.length) {
      const timer = setTimeout(() => {
        setDisplayedLines((prev) => {
          const newLines = [...prev]
          if (newLines[currentLineIndex]) {
            newLines[currentLineIndex] = currentLine.substring(0, currentCharIndex + 1)
          } else {
            newLines[currentLineIndex] = currentLine.substring(0, currentCharIndex + 1)
          }
          return newLines
        })
        setCurrentCharIndex((prev) => prev + 1)
      }, speed)

      return () => clearTimeout(timer)
    } else {
      // Line is complete, move to next line after delay
      const timer = setTimeout(() => {
        setCurrentLineIndex((prev) => prev + 1)
        setCurrentCharIndex(0)
      }, delay)

      return () => clearTimeout(timer)
    }
  }, [currentLineIndex, currentCharIndex, lines, speed, delay])

  return (
    <div className={className}>
      {displayedLines.map((line, index) => (
        <div key={index} className="text-xs sm:text-sm">
          {line}
          {index === currentLineIndex && !isComplete && <span className="terminal-cursor-block ml-1">█</span>}
        </div>
      ))}
    </div>
  )
}
