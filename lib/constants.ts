export const SITE_CONFIG = {
  name: "TERMNL",
  description: "Retro Terminal Chat Network - Est. 1985",
  url: process.env.NODE_ENV === "production" ? "https://termnl.app" : "http://localhost:3000",
  domain: "termnl.app",
  creator: "@termnl",
  keywords: ["terminal", "chat", "retro", "1980s", "encrypted", "messaging"],
}

export const getBaseUrl = () => {
  // Always use the production domain for invite URLs
  if (process.env.NODE_ENV === "production") {
    return "https://termnl.app"
  }

  // For development, check if we're running locally
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:3000"
    }
  }

  // Default to production domain for any other case (including preview deployments)
  return "https://termnl.app"
}

export const getInviteBaseUrl = () => {
  // Always use the production domain for invite URLs, regardless of environment
  return "https://termnl.app"
}
