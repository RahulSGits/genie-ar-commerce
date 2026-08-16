/**
 * Applies the current plan ladder to an EXISTING database.
 *
 *   node scripts/reprice.mjs           # show what would change
 *   node scripts/reprice.mjs --apply   # write it
 *
 * `npm run db:seed` wipes and recreates everything, which is correct for a
 * fresh install and catastrophic for one with customers in it. This is the
 * other half: an idempotent upsert keyed on plan slug, so repricing production
 * is a reviewable operation rather than hand-edited SQL.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *
 * Existing subscriptions. A business that signed at ₹999 keeps paying ₹999
 * until someone decides otherwise, because `negotiated_price_minor` on the
 * subscription overrides the plan price — that column exists precisely so a
 * price change cannot silently quadruple a live customer's bill. Any
 * subscription on a plan whose price moved is REPORTED here so the decision to
 * grandfather or migrate is made by a person.
 */

import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { existsSync } from 'node:fs'

const MB = 1024 * 1024
const APPLY = process.argv.includes('--apply')

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'arview.db')
if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Run \`npm run db:seed\` first.`)
  process.exit(1)
}

const FEATURES_OFF = {
  advanced_analytics: false,
  custom_branding: false,
  white_label: false,
  custom_domain: false,
  team_members: false,
  api_access: false,
  priority_support: false,
  model_generation: false,
}

/**
 * The ladder. Kept in step with scripts/seed.mjs — if these two disagree, a
 * fresh install and a repriced one end up on different plans, which is the
 * kind of drift nobody notices until a customer asks why their limits differ.
 */
const PLANS = [
  {
    slug: 'starter',
    name: 'Starter',
    priceMinor: 399900,
    setupFeeMinor: 299900,
    sortOrder: 1,
    isPublic: true,
    description: 'For a single outlet putting its first products into AR.',
    limits: {
      maxProducts: 15,
      maxArModels: 15,
      maxQrCodes: 25,
      maxStorageBytes: 500 * MB,
      maxTeamMembers: 2,
      maxMonthlyScans: 25000,
    },
    features: {},
  },
  {
    slug: 'growth',
    name: 'Growth',
    priceMinor: 899900,
    setupFeeMinor: 499900,
    sortOrder: 2,
    isPublic: true,
    description: 'For growing brands running the full catalogue in AR, with a team.',
    limits: {
      maxProducts: 60,
      maxArModels: 60,
      maxQrCodes: 150,
      maxStorageBytes: 2048 * MB,
      maxTeamMembers: 6,
      maxMonthlyScans: 100000,
    },
    features: { advanced_analytics: true, custom_branding: true, team_members: true },
  },
  {
    slug: 'business',
    name: 'Business',
    priceMinor: 1999900,
    setupFeeMinor: 999900,
    sortOrder: 3,
    isPublic: true,
    description:
      'For multi-location brands: white-label, custom domain, API access and priority support.',
    limits: {
      maxProducts: 250,
      maxArModels: 250,
      maxQrCodes: null,
      maxStorageBytes: 10240 * MB,
      maxTeamMembers: 20,
      maxMonthlyScans: 500000,
    },
    features: {
      advanced_analytics: true,
      custom_branding: true,
      team_members: true,
      white_label: true,
      custom_domain: true,
      priority_support: true,
      api_access: true,
    },
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    priceMinor: 0,
    setupFeeMinor: 0,
    sortOrder: 4,
    // Quoted, not bought. A public ₹0 plan reads as "free" on the pricing page.
    isPublic: false,
    description: 'Custom pricing for chains and groups. Negotiated limits, SLA and onboarding.',
    limits: {
      maxProducts: null,
      // Bounded even here: every generation spends real provider credits, and
      // "unlimited" on a fixed price is an unbounded liability. Enterprise
      // deals raise this per business via limits_override.
      maxArModels: 2000,
      maxQrCodes: null,
      maxStorageBytes: 51200 * MB,
      maxTeamMembers: null,
      maxMonthlyScans: null,
    },
    features: {
      advanced_analytics: true,
      custom_branding: true,
      team_members: true,
      white_label: true,
      custom_domain: true,
      priority_support: true,
      api_access: true,
      model_generation: true,
    },
  },
]

/** Plans that existed under the old ladder and no longer do. */
const RETIRED_SLUGS = ['pro']

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')

const now = () => new Date().toISOString()
const inr = (minor) => `₹${(minor / 100).toLocaleString('en-IN')}`

const changes = []
const warnings = []

for (const plan of PLANS) {
  const existing = db
    .prepare(`SELECT * FROM subscription_plans WHERE slug = ?`)
    .get(plan.slug)

  const features = JSON.stringify({ ...FEATURES_OFF, ...plan.features })
  const limits = JSON.stringify(plan.limits)

  if (!existing) {
    changes.push(`CREATE  ${plan.name.padEnd(11)} ${inr(plan.priceMinor)}/mo`)
    if (APPLY) {
      db.prepare(
        `INSERT INTO subscription_plans
           (id, slug, name, description, price_minor, currency, billing_interval,
            setup_fee_minor, limits, features, trial_days, is_public, sort_order,
            archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'INR', 'monthly', ?, ?, ?, 14, ?, ?, 0, ?, ?)`,
      ).run(
        randomUUID(), plan.slug, plan.name, plan.description, plan.priceMinor,
        plan.setupFeeMinor, limits, features, plan.isPublic ? 1 : 0, plan.sortOrder,
        now(), now(),
      )
    }
    continue
  }

  if (existing.price_minor !== plan.priceMinor) {
    changes.push(
      `UPDATE  ${plan.name.padEnd(11)} ${inr(existing.price_minor)}/mo → ${inr(plan.priceMinor)}/mo`,
    )

    // Anyone on this plan at the old price. Reported, never changed.
    const affected = db
      .prepare(
        `SELECT b.name, s.negotiated_price_minor, s.status
           FROM subscriptions s
           JOIN businesses b ON b.id = s.business_id
          WHERE s.plan_id = ? AND b.deleted_at IS NULL`,
      )
      .all(existing.id)

    for (const sub of affected) {
      const paying = sub.negotiated_price_minor ?? existing.price_minor
      warnings.push(
        `${sub.name} (${sub.status}) pays ${inr(paying)}` +
          (sub.negotiated_price_minor === null
            ? ` — has NO negotiated price, so this repricing moves them to ${inr(plan.priceMinor)}`
            : ` — negotiated, unaffected`),
      )
    }
  } else {
    changes.push(`OK      ${plan.name.padEnd(11)} ${inr(plan.priceMinor)}/mo`)
  }

  if (APPLY) {
    db.prepare(
      `UPDATE subscription_plans
          SET name = ?, description = ?, price_minor = ?, setup_fee_minor = ?,
              limits = ?, features = ?, is_public = ?, sort_order = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      plan.name, plan.description, plan.priceMinor, plan.setupFeeMinor,
      limits, features, plan.isPublic ? 1 : 0, plan.sortOrder, now(), existing.id,
    )
  }
}

for (const slug of RETIRED_SLUGS) {
  const existing = db.prepare(`SELECT * FROM subscription_plans WHERE slug = ?`).get(slug)
  if (!existing || existing.archived === 1) continue

  const holders = db
    .prepare(`SELECT COUNT(*) AS c FROM subscriptions WHERE plan_id = ?`)
    .get(existing.id)

  // Archived, never deleted: a subscription still points at it, and the
  // invoices already raised reference its name. Deleting the row would break
  // the billing history of every customer who was ever on it.
  changes.push(`ARCHIVE ${existing.name} (${holders.c} subscription${holders.c === 1 ? '' : 's'} still on it)`)
  if (APPLY) {
    db.prepare(`UPDATE subscription_plans SET archived = 1, is_public = 0, updated_at = ? WHERE id = ?`)
      .run(now(), existing.id)
  }
}

console.log(`\n  Plan ladder — ${APPLY ? 'APPLYING' : 'dry run'}\n`)
for (const line of changes) console.log(`    ${line}`)

if (warnings.length > 0) {
  console.log(`\n  Existing subscriptions affected:\n`)
  for (const line of warnings) console.log(`    ${line}`)
  console.log(
    `\n  To grandfather a customer, set a negotiated price on their subscription\n` +
      `  in /admin/businesses before applying. The shared plan is never edited\n` +
      `  to accommodate one customer.`,
  )
}

if (!APPLY) console.log(`\n  Nothing written. Re-run with --apply to commit.\n`)
else console.log(`\n  Applied.\n`)

db.close()
