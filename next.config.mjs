/** @type {import('next').NextConfig} */

/**
 * Security headers applied to every route.
 *
 * No CSP here yet: the AR viewer needs `blob:` and `data:` for generated
 * textures and Draco workers, and Next's dev overlay needs 'unsafe-eval'.
 * A production CSP belongs in middleware where it can be nonce-based —
 * tracked in docs/security.md rather than half-done here.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    // AR needs camera + motion sensors on our own origin, nowhere else.
    key: 'Permissions-Policy',
    value: [
      'camera=(self)',
      'gyroscope=(self)',
      'accelerometer=(self)',
      'magnetometer=(self)',
      'xr-spatial-tracking=(self)',
      'microphone=()',
      'geolocation=()',
      'payment=()',
    ].join(', '),
  },
]

const nextConfig = {
  reactStrictMode: true,

  // `npm run build` writes to .next-build so a production build can never
  // overwrite the chunks a running `npm run dev` is serving from .next.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  images: {
    // Supabase Storage serves public assets from the project host.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // 3D assets are content-addressed by upload id and never mutate in
        // place, so they can be cached hard.
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },

  experimental: {
    // Keeps Server Action payloads sane; model uploads go direct to Storage
    // from the browser rather than through an action.
    serverActions: { bodySizeLimit: '4mb' },
  },
}

export default nextConfig
