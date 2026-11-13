import path from "node:path"
import { fileURLToPath } from "node:url"

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['termnl.app', 'www.termnl.app', 'localhost:3000']
    }
  },
  async rewrites() {
    return [{ source: '/.well-known/nostr.json', destination: '/api/nostr' }]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:${process.env.NODE_ENV === 'development' ? ' ws:' : ''}; worker-src 'self' blob:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/www',
        destination: '/',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
