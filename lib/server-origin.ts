export function serverOrigin(request: { url: string; headers: Headers }) {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim()
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  const known = ["termnl.app", "www.termnl.app", process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
  return local || known.includes(host) ? `${local ? "http" : "https"}://${host}` : new URL(request.url).origin
}
