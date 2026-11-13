"use client"

import { useTheme } from "next-themes"

// Both labels are rendered and CSS picks one, so there is no hydration mismatch.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return <button type="button" className="text-xs text-t-muted underline hover:text-t-ink" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
    <span className="dark:hidden">Terminal mode</span><span className="hidden dark:inline">Light mode</span>
  </button>
}
