'use client'

import { useActionState, useState, useTransition } from 'react'
import { FileJson } from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Field, Input, Textarea,
} from '@/components/ui'
import { saveBrandingAction, saveCmsSectionAction } from '@/lib/actions/admin'
import type { ActionResult } from '@/lib/auth/errors'
import { formatDateTime } from '@/lib/utils'

type CmsSection = { key: string; content: unknown; updatedAt: string }

type Branding = {
  name: string
  tagline: string
  logoUrl: string | null
  faviconEmoji: string
  primaryColor: string
  supportEmail: string
  supportPhone: string
}

/** What each key actually renders, so nobody edits JSON blind. */
const SECTION_GUIDE: Record<string, string> = {
  landing_hero: 'The headline, sub-heading and call-to-action at the top of the public home page.',
  landing_features: 'The feature cards below the hero on the home page.',
  faq: 'The question-and-answer list on the home page.',
  footer: 'Footer links, contact details and the copyright line.',
}

export default function CmsEditor({
  sections,
  branding,
}: {
  sections: CmsSection[]
  branding: Branding
}) {
  return (
    <div className="space-y-6">
      <BrandingForm branding={branding} />

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Page content</h2>
          <p className="text-muted-foreground text-sm">
            Each section is stored as JSON and rendered on the public site. Edit the values, keep the
            shape.
          </p>
        </div>

        {sections.length === 0 ? (
          <EmptyState
            icon={<FileJson />}
            title="No content sections"
            description="Seed the database to create the landing page sections."
          />
        ) : (
          sections.map((section) => <SectionEditor key={section.key} section={section} />)
        )}
      </div>
    </div>
  )
}

/* ── one section ────────────────────────────────────────────────────────── */

function SectionEditor({ section }: { section: CmsSection }) {
  const [draft, setDraft] = useState(() => JSON.stringify(section.content, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function save() {
    // Parsing here first turns a typo into an inline message instead of a round trip.
    try {
      JSON.parse(draft)
    } catch (err) {
      setSaved(false)
      setError(err instanceof Error ? err.message : 'That isn’t valid JSON.')
      return
    }
    setError(null)

    startTransition(async () => {
      const result = await saveCmsSectionAction(section.key, draft)
      if (result.ok) {
        setSaved(true)
      } else {
        setSaved(false)
        setError(result.error)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{section.key}</CardTitle>
          <Badge variant="muted">JSON</Badge>
        </div>
        <CardDescription>
          {SECTION_GUIDE[section.key] ?? 'Custom section rendered wherever this key is referenced.'}
          {' Last edited '}
          {formatDateTime(section.updatedAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          aria-label={`${section.key} content`}
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setSaved(false)
          }}
          className="min-h-64 font-mono text-xs"
        />

        {error && <Alert variant="destructive">{error}</Alert>}
        {saved && !error && <Alert variant="success">Saved. The public page is already updated.</Alert>}

        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save section'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(JSON.stringify(section.content, null, 2))
              setError(null)
              setSaved(false)
            }}
          >
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── branding ───────────────────────────────────────────────────────────── */

function BrandingForm({ branding }: { branding: Branding }) {
  const [state, action, pending] = useActionState<ActionResult<null> | null, FormData>(
    saveBrandingAction,
    null,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Branding</CardTitle>
        <CardDescription>
          Applies to the public site, both dashboards and every invoice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
          {state?.ok && <Alert variant="success">Branding saved.</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Platform name" htmlFor="brand-name" required>
              <Input id="brand-name" name="name" defaultValue={branding.name} required />
            </Field>

            <Field label="Tagline" htmlFor="brand-tagline">
              <Input id="brand-tagline" name="tagline" defaultValue={branding.tagline} />
            </Field>

            <Field label="Logo URL" htmlFor="brand-logo" hint="Leave empty to use the emoji mark.">
              <Input id="brand-logo" name="logoUrl" defaultValue={branding.logoUrl ?? ''} />
            </Field>

            <Field
              label="Favicon emoji"
              htmlFor="brand-favicon"
              hint="Shown in the sidebar and the browser tab."
            >
              <Input
                id="brand-favicon"
                name="faviconEmoji"
                maxLength={4}
                defaultValue={branding.faviconEmoji}
              />
            </Field>

            <Field label="Primary colour" htmlFor="brand-color" hint="Hex value, e.g. #5b3df5.">
              <Input id="brand-color" name="primaryColor" defaultValue={branding.primaryColor} />
            </Field>

            <Field label="Support email" htmlFor="brand-email">
              <Input
                id="brand-email"
                name="supportEmail"
                type="email"
                defaultValue={branding.supportEmail}
              />
            </Field>

            <Field label="Support phone" htmlFor="brand-phone">
              <Input
                id="brand-phone"
                name="supportPhone"
                type="tel"
                defaultValue={branding.supportPhone}
              />
            </Field>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save branding'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
