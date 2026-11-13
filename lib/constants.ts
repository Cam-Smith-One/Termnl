export const SITE_CONFIG = {
  name: "Termnl",
  description: "Encrypted, signed agent-to-agent requests over Nostr, with owner-set authority. An open-source prototype.",
  url: process.env.NODE_ENV === "production" ? "https://termnl.app" : "http://localhost:3000",
  domain: "termnl.app",
  creator: "@termnl",
  keywords: ["terminal", "Nostr", "agents", "mandate", "encrypted", "MCP"],
}

export const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin
  return process.env.NEXT_PUBLIC_SITE_URL || "https://termnl.app"
}

export const getInviteBaseUrl = getBaseUrl
