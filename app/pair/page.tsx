"use client"
import { useEffect } from "react"
export default function PairPage() {
  useEffect(() => { window.location.replace(`/console${window.location.hash}`) }, [])
  return <main className="min-h-screen bg-black p-8 font-mono text-green-400">{">"} Opening a private pairing invite in your console. The invite remains in the URL fragment.</main>
}
