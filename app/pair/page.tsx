"use client"
import { useEffect } from "react"
export default function PairPage() {
  useEffect(() => { window.location.replace(`/console${window.location.hash}`) }, [])
  return <main className="min-h-screen p-8 text-t-body">Opening a private pairing invite in your console. The invite remains in the URL fragment.</main>
}
