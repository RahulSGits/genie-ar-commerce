import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui'
import { getBranding, getCmsSection } from '@/lib/db/repositories/platform'

export const dynamic = 'force-dynamic'

const SLUGS = ['privacy', 'terms', 'refunds'] as const
type Slug = (typeof SLUGS)[number]

/**
 * Legal pages.
 *
 * Editable from the admin CMS under `legal_<slug>`, with a real document
 * shipped as the fallback. A placeholder here would be worse than useless: the
 * privacy text below describes what this system actually does, and shipping
 * "Lorem ipsum" until someone remembers to write it would be a false statement
 * on a page customers rely on.
 */

type LegalDoc = {
  title: string
  updatedAt?: string
  intro?: string
  sections: Array<{ heading: string; body: string[] }>
}

function isSlug(value: string): value is Slug {
  return (SLUGS as readonly string[]).includes(value)
}

export function generateStaticParams(): Array<{ slug: Slug }> {
  return SLUGS.map((slug) => ({ slug }))
}

const TITLES: Record<Slug, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  refunds: 'Refund Policy',
}

const DESCRIPTIONS: Record<Slug, string> = {
  privacy:
    'What we collect, what we deliberately do not collect, and why customers scanning a QR code stay anonymous.',
  terms: 'The terms that govern business accounts, AR product pages and printed QR codes.',
  refunds: 'When setup fees and subscription payments are refundable, and how to ask.',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  if (!isSlug(slug)) return { title: 'Not found' }

  const doc = getCmsSection<LegalDoc>(`legal_${slug}`)
  return {
    title: doc?.title ?? TITLES[slug],
    description: DESCRIPTIONS[slug],
    robots: { index: true, follow: true },
  }
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!isSlug(slug)) notFound()

  const branding = getBranding()
  const doc = getCmsSection<LegalDoc>(`legal_${slug}`) ?? defaultDoc(slug, branding.name, branding.supportEmail)

  return (
    <div className="min-h-svh">
      <header className="safe-t sticky top-0 z-40 border-b bg-background/80 backdrop-blur-lg">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-primary grid size-8 place-items-center rounded-lg text-base">
              {branding.faviconEmoji ?? '📦'}
            </span>
            {branding.name}
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">Pricing</Link>
          </Button>
        </nav>
      </header>

      <main id="main" className="px-4 py-14">
        <article className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
          {doc.updatedAt && (
            <p className="text-muted-foreground mt-2 text-sm">Last updated {doc.updatedAt}</p>
          )}
          {doc.intro && (
            <p className="text-muted-foreground mt-5 leading-relaxed text-pretty">{doc.intro}</p>
          )}

          <div className="mt-10 space-y-9">
            {doc.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
                <div className="mt-2.5 space-y-3">
                  {section.body.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-muted-foreground text-sm leading-relaxed text-pretty"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap gap-4 border-t pt-6 text-sm">
            {SLUGS.filter((s) => s !== slug).map((s) => (
              <Link key={s} href={`/legal/${s}`} className="text-primary underline-offset-4 hover:underline">
                {TITLES[s]}
              </Link>
            ))}
            <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">
              Back to home
            </Link>
          </div>
        </article>
      </main>
    </div>
  )
}

/**
 * Fallbacks describing this product specifically. Generic boilerplate would
 * over-promise — most SaaS privacy templates disclaim cookies, ad networks and
 * card processing that this system does not have.
 */
function defaultDoc(slug: Slug, brand: string, supportEmail: string): LegalDoc {
  const contact = supportEmail || 'our support address'

  if (slug === 'privacy') {
    return {
      title: TITLES.privacy,
      intro: `${brand} has two very different kinds of people using it: businesses who sign in to manage their catalogue, and their customers who scan a printed QR code. This policy treats them separately, because we hold almost nothing about the second group.`,
      sections: [
        {
          heading: 'Customers who scan a QR code',
          body: [
            'Scanning a code opens a web page. You are never asked to create an account, log in, enter an email address, or accept a cookie banner. We do not know who you are and we do not try to find out.',
            'We set no advertising cookies and run no third-party trackers on these pages.',
          ],
        },
        {
          heading: 'Your camera never leaves your device',
          body: [
            'The augmented reality view runs entirely inside your own browser and your device’s operating system. The camera feed is used on the device to work out where the floor or the table is, and to draw the 3D model into the picture you see.',
            'No frame of that camera imagery is ever uploaded, transmitted, recorded or stored by us. There is no server that receives it. Closing the page ends the session and nothing of it remains.',
            'Your browser will ask for camera permission before AR starts. Declining it simply keeps you in the interactive 3D viewer, which works without the camera.',
          ],
        },
        {
          heading: 'What the analytics actually record',
          body: [
            'So a business can tell whether their codes are working, we count events: the page opened, the 3D viewer opened, AR was launched, the model was placed, the order button was tapped.',
            'Alongside each event we store only coarse buckets — a device type such as “mobile”, a browser family, an operating system family, and whether the device supported AR. These are broad categories shared by millions of devices. They are not a fingerprint and cannot be combined to single you out.',
            'We do not store IP addresses, full user-agent strings, precise location, device identifiers, or any browser fingerprint. Each page load generates a random session identifier that exists only in memory for that visit; it is never written to your device and never links one visit to another.',
          ],
        },
        {
          heading: 'Business accounts',
          body: [
            'For businesses who sign in we hold what running the account requires: the account holder’s name and email address, a hashed password, the business’s contact and address details, its catalogue and 3D models, and its billing history.',
            'A session cookie keeps you signed in. It is strictly necessary for the dashboard to function and is not used for tracking.',
            'Business data is scoped to that business. One business can never read another’s catalogue, analytics or invoices.',
          ],
        },
        {
          heading: 'Sharing and retention',
          body: [
            'We do not sell data and we do not share it with advertisers or data brokers. Analytics events are aggregated for the business that owns the QR code, and for nobody else.',
            'Business data is retained while the account is open. Close the account and we delete the catalogue, models and analytics, keeping only the invoice records that tax law requires us to keep.',
          ],
        },
        {
          heading: 'Your rights and contact',
          body: [
            'Business account holders can request a copy of their data, correct it, or ask for deletion at any time by writing to us.',
            `Questions about this policy go to ${contact}.`,
          ],
        },
      ],
    }
  }

  if (slug === 'terms') {
    return {
      title: TITLES.terms,
      intro: `These terms cover business accounts on ${brand}. Customers who scan a QR code are not party to them — they are simply visiting a web page.`,
      sections: [
        {
          heading: 'The service',
          body: [
            'We host 3D product models, publish an AR product page for each product you choose to publish, and generate printable QR codes that point at those pages. We give you analytics on how those codes are used.',
            'AR availability depends on the visitor’s device and browser. Where a device cannot run AR, the product still opens in an interactive 3D viewer. We do not guarantee AR on every device, because that is not within our control.',
          ],
        },
        {
          heading: 'Your account',
          body: [
            'You are responsible for the security of your login and for what people you invite to your account do with it. Tell us promptly if you believe an account has been compromised.',
            'One account represents one business. Reselling access, or publishing another company’s catalogue through your account, requires our written agreement first.',
          ],
        },
        {
          heading: 'Your content',
          body: [
            'You keep ownership of your product information, images and 3D models. You grant us only the licence needed to host them and to serve them on your public AR pages.',
            'You confirm you have the right to use what you upload, that your product descriptions and prices are accurate, and that nothing you publish is unlawful.',
            'We may remove content that is unlawful or that puts the platform at risk. Where we do, we will tell you why.',
          ],
        },
        {
          heading: 'Fees and payment',
          body: [
            'Plans carry a monthly subscription and, where applicable, a one-time setup fee for each 3D model we produce. Current pricing is on the pricing page.',
            'There is no card on file and nothing is charged automatically. We raise an invoice and you settle it by bank transfer, UPI or cash within the stated terms.',
            'If an invoice is overdue we will contact you. Your published AR pages and printed codes stay live while we do — we will not silently take down a code that is sitting on a customer’s table. Suspension only follows a deliberate decision after the grace period, and we will have told you first.',
          ],
        },
        {
          heading: 'Cancellation',
          body: [
            'You may cancel at any time. Your AR pages remain live to the end of the period you have already paid for, then stop resolving.',
            'Export your catalogue and models before that date. We keep them for a short window afterwards as a courtesy, not as a guarantee.',
          ],
        },
        {
          heading: 'Availability and liability',
          body: [
            'We work to keep AR pages available, but the service is provided as-is and we do not promise uninterrupted availability. Planned maintenance is scheduled outside typical service hours where we can.',
            'To the extent the law allows, our total liability in any twelve-month period is limited to the fees you paid us in that period. We are not liable for lost profits or indirect losses.',
          ],
        },
        {
          heading: 'Changes and contact',
          body: [
            'We will give reasonable notice of material changes to these terms or to pricing. Continuing to use the service after that notice means you accept the change.',
            `Questions go to ${contact}.`,
          ],
        },
      ],
    }
  }

  return {
    title: TITLES.refunds,
    intro:
      'Because we invoice you rather than charge a card, most billing questions are settled before money moves. This policy covers the cases where it already has.',
    sections: [
      {
        heading: 'Subscription fees',
        body: [
          'Subscriptions are billed for a period in advance. If you cancel mid-period, your AR pages stay live until that period ends and we do not pro-rate a refund for the unused days.',
          'If we billed you for a period after you had already asked us to cancel, that is our error and we refund it in full.',
        ],
      },
      {
        heading: 'Setup fees for 3D models',
        body: [
          'A setup fee covers producing a model: photographing or interpreting your product, building the geometry, and optimising it to load quickly on a phone.',
          'Before we start work the fee is fully refundable. Once work has begun it is refundable in proportion to what remains undone.',
          'If a delivered model does not match the product it depicts, we revise it at no charge. If we cannot get it right, we refund that model’s setup fee in full.',
        ],
      },
      {
        heading: 'Service failures',
        body: [
          'If your published AR pages are unavailable through our fault for a sustained period, tell us and we will credit the affected days against your next invoice.',
          'A visitor’s device being unable to run AR is not a service failure — those visitors still reach the 3D viewer, which is the documented behaviour.',
        ],
      },
      {
        heading: 'How to ask',
        body: [
          `Write to ${contact} with the invoice number and what went wrong. We respond within five working days.`,
          'Approved refunds are returned by the same route the payment arrived — the bank account or UPI ID that paid the invoice — normally within ten working days.',
        ],
      },
    ],
  }
}
