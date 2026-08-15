import type { Metadata, Viewport } from 'next'
import { getBranding } from '@/lib/db/repositories/platform'
import './globals.css'

/**
 * Title and description come from the branding settings rather than constants,
 * so renaming the platform in /admin/content renames the browser tab, the
 * social previews and the search listing too.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = getBranding()

  return {
    title: {
      default: `${branding.name} — ${branding.tagline}`,
      template: `%s · ${branding.name}`,
    },
    description:
      'Upload a product image. Turn it into an immersive 3D experience, generate a shareable QR code, and let customers view it in AR — no app, no signup.',
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    applicationName: branding.name,
    openGraph: {
      type: 'website',
      siteName: branding.name,
      title: `${branding.name} — ${branding.tagline}`,
    },
    twitter: { card: 'summary_large_image' },
    robots: { index: true, follow: true },
    icons: {
      // Inline SVG favicon: the mark, no binary asset to keep in sync.
      icon: [
        {
          url:
            'data:image/svg+xml,' +
            encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
                `<rect width="32" height="32" rx="7" fill="#7c3aed"/>` +
                `<path d="M25.5 9.4A11 11 0 1 0 27 16h-9" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" transform="scale(0.82) translate(3.4 3.4)"/>` +
                `<path d="M16 11.6l4.4 2.5v5l-4.4 2.5-4.4-2.5v-5L16 11.6z" stroke="#fff" stroke-width="1.7" fill="none" transform="scale(0.82) translate(3.4 3.4)"/>` +
                `</svg>`,
            ),
          type: 'image/svg+xml',
        },
      ],
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays enabled — disabling it fails WCAG 1.4.4 and breaks low-vision use.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfdff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0d18' },
  ],
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh">
        <a
          href="#main"
          className="bg-background focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:px-4 focus:py-2 focus:ring-2"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
