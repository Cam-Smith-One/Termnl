export const SITE_CONFIG = {
  name: "TERMNL",
  description: "Retro Terminal Chat Network - Est. 1985",
  url: process.env.NODE_ENV === "production" ? "https://termnl.app" : "http://localhost:3000",
  domain: "termnl.app",
  creator: "@termnl",
  keywords: ["terminal", "chat", "retro", "1980s", "encrypted", "messaging"],
}

export const getBaseUrl = () => {
  if (typeof window !== "undefined") {
    return window.location.origin
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  if (process.env.NODE_ENV === "production") {
    return "https://termnl.app"
  }

  return "http://localhost:3000"
}
