/**
 * Development seed.
 *
 *   npm run db:seed
 *
 * Creates the super admin, pricing plans, two demo businesses across different
 * verticals, products wired to the generated GLB models, QR codes, ~6 weeks of
 * analytics, invoices with payments, and a CRM pipeline.
 *
 * Deliberately uses its own database connection and raw SQL rather than
 * importing lib/db — a seed that depends on application internals breaks every
 * time they are refactored, and lib/db is marked `server-only` for Next.
 *
 * SAFE TO RE-RUN: it clears the demo rows it owns first.
 */

import { DatabaseSync } from 'node:sqlite'
import { randomUUID, randomBytes, scryptSync, createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'arview.db')
mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec(readFileSync(path.join(process.cwd(), 'lib', 'db', 'schema.sql'), 'utf8'))

const uuid = () => randomUUID()
const now = () => new Date().toISOString()
const iso = (d) => d.toISOString()
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000)
const day = (d) => d.toISOString().slice(0, 10)

/** Matches lib/auth/password.ts exactly: scrypt$N$r$p$salt$hash */
function hashPassword(password) {
  const N = 2 ** 16, r = 8, p = 1, keylen = 64
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, keylen, { N, r, p, maxmem: 256 * 1024 * 1024 })
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$')
}

/* ── credentials ────────────────────────────────────────────────────────── */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@arview.local'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'arview-admin-2026'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-business-2026'

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    '\n⚠  ADMIN_PASSWORD not set — using the documented development default.\n' +
      '   Set ADMIN_EMAIL and ADMIN_PASSWORD in .env.local before deploying anywhere real.\n',
  )
}

/* ── wipe demo data ─────────────────────────────────────────────────────── */

console.log('Clearing existing data…')
for (const table of [
  'analytics_events', 'qr_codes', 'products', 'menu_categories', 'three_d_models',
  'invoice_items', 'payments', 'invoices', 'subscriptions', 'business_members',
  'businesses', 'crm_activities', 'crm_notes', 'crm_tasks', 'crm_leads',
  'notification_logs', 'notifications', 'sessions', 'users',
  'subscription_plans', 'coupons', 'promotions', 'reminder_rules',
  'cms_sections', 'system_settings', 'audit_logs', 'ticket_messages', 'support_tickets',
]) {
  db.exec(`DELETE FROM ${table}`)
}

/* ── users ──────────────────────────────────────────────────────────────── */

function createUser(email, password, fullName, isSuperAdmin = false) {
  const id = uuid()
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, is_super_admin, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, email, hashPassword(password), fullName, isSuperAdmin ? 1 : 0, now(), now())
  return id
}

const adminId = createUser(ADMIN_EMAIL, ADMIN_PASSWORD, 'Platform Owner', true)
const bitesOwnerId = createUser('owner@urbanbites.local', DEMO_PASSWORD, 'Priya Nair')
const threadsOwnerId = createUser('owner@urbanthreads.local', DEMO_PASSWORD, 'Arjun Mehta')
console.log('✓ users')

/* ── plans ──────────────────────────────────────────────────────────────── */

const FEATURES_OFF = {
  advanced_analytics: false, custom_branding: false, white_label: false,
  custom_domain: false, team_members: false, api_access: false,
  priority_support: false, model_generation: false,
}

function createPlan(slug, name, priceMinor, setupFeeMinor, limits, features, sortOrder, description) {
  const id = uuid()
  db.prepare(
    `INSERT INTO subscription_plans
       (id, slug, name, description, price_minor, currency, billing_interval, setup_fee_minor,
        limits, features, trial_days, is_public, sort_order, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'INR', 'monthly', ?, ?, ?, 14, 1, ?, 0, ?, ?)`,
  ).run(
    id, slug, name, description, priceMinor, setupFeeMinor,
    JSON.stringify(limits), JSON.stringify({ ...FEATURES_OFF, ...features }),
    sortOrder, now(), now(),
  )
  return id
}

const MB = 1024 * 1024

const starterId = createPlan(
  'starter', 'Starter', 99900, 50000,
  { maxProducts: 5, maxArModels: 5, maxQrCodes: 5, maxStorageBytes: 100 * MB, maxTeamMembers: 1, maxMonthlyScans: null },
  {}, 1,
  'For a single outlet getting started with AR.',
)
const growthId = createPlan(
  'growth', 'Growth', 199900, 99900,
  { maxProducts: 20, maxArModels: 20, maxQrCodes: 20, maxStorageBytes: 500 * MB, maxTeamMembers: 3, maxMonthlyScans: null },
  { advanced_analytics: true, custom_branding: true, team_members: true }, 2,
  'For growing businesses that want the full catalog in AR.',
)
const proId = createPlan(
  'pro', 'Pro', 399900, 149900,
  { maxProducts: 50, maxArModels: 50, maxQrCodes: null, maxStorageBytes: 2048 * MB, maxTeamMembers: 10, maxMonthlyScans: null },
  {
    advanced_analytics: true, custom_branding: true, team_members: true,
    white_label: true, custom_domain: true, priority_support: true,
  }, 3,
  'For multi-outlet brands needing white-label and priority support.',
)
console.log('✓ plans')

/* ── businesses ─────────────────────────────────────────────────────────── */

function createBusiness(b) {
  const id = uuid()
  db.prepare(
    `INSERT INTO businesses
       (id, slug, name, category, description, brand_color, phone, email, city,
        website_url, instagram_url, ordering_url, menu_url, store_url,
        currency, timezone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'Asia/Kolkata', 'active', ?, ?)`,
  ).run(
    id, b.slug, b.name, b.category, b.description, b.brandColor, b.phone, b.email, b.city,
    b.websiteUrl ?? null, b.instagramUrl ?? null, b.orderingUrl ?? null,
    b.menuUrl ?? null, b.storeUrl ?? null,
    iso(daysFromNow(-b.ageDays)), now(),
  )
  return id
}

const bitesId = createBusiness({
  slug: 'urban-bites', name: 'Urban Bites', category: 'restaurant',
  description: 'Neighbourhood burger joint and coffee bar.',
  brandColor: '#e8623c', phone: '+91 98200 11223', email: 'hello@urbanbites.local',
  city: 'Mumbai', websiteUrl: 'https://example.com/urban-bites',
  instagramUrl: 'https://instagram.com/urbanbites',
  orderingUrl: 'https://example.com/urban-bites/order',
  menuUrl: 'https://example.com/urban-bites/menu', ageDays: 96,
})

const threadsId = createBusiness({
  slug: 'urban-threads', name: 'Urban Threads', category: 'clothing',
  description: 'Independent streetwear and footwear label.',
  brandColor: '#3b5bdb', phone: '+91 98200 44556', email: 'hello@urbanthreads.local',
  city: 'Bengaluru', websiteUrl: 'https://example.com/urban-threads',
  storeUrl: 'https://example.com/urban-threads/shop', ageDays: 47,
})

db.prepare(`INSERT INTO business_members (id, business_id, user_id, role, created_at) VALUES (?,?,?,?,?)`)
  .run(uuid(), bitesId, bitesOwnerId, 'owner', now())
db.prepare(`INSERT INTO business_members (id, business_id, user_id, role, created_at) VALUES (?,?,?,?,?)`)
  .run(uuid(), threadsId, threadsOwnerId, 'owner', now())

/* Subscriptions: Growth (negotiated down) and Starter on trial. */
function createSubscription(businessId, planId, status, negotiated, ageDays) {
  const id = uuid()
  const start = daysFromNow(-ageDays)
  const end = daysFromNow(30 - (ageDays % 30))
  db.prepare(
    `INSERT INTO subscriptions
       (id, business_id, plan_id, status, negotiated_price_minor, billing_interval,
        trial_ends_at, current_period_start, current_period_end, grace_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'monthly', ?, ?, ?, 7, ?, ?)`,
  ).run(
    id, businessId, planId, status, negotiated,
    status === 'trialing' ? iso(daysFromNow(6)) : null,
    iso(start), iso(end), now(), now(),
  )
  return id
}

// Urban Bites negotiated ₹1,499 against the ₹1,999 Growth plan — the shared
// plan is untouched, which is the whole point of negotiated_price_minor.
const bitesSubId = createSubscription(bitesId, growthId, 'active', 149900, 96)
const threadsSubId = createSubscription(threadsId, starterId, 'trialing', null, 6)
console.log('✓ businesses + subscriptions')

/* ── models ─────────────────────────────────────────────────────────────── */

function createModel(businessId, name, file, sizeKb, tris) {
  const id = uuid()
  const glb = `/models/${file}`
  const p = path.join(process.cwd(), 'public', 'models', file)
  if (!existsSync(p)) {
    console.warn(`  ! ${file} missing — run: node scripts/generate-demo-models.mjs`)
  }
  db.prepare(
    `INSERT INTO three_d_models
       (id, business_id, name, glb_url, file_size_bytes, format, triangle_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'glb', ?, 'ready', ?, ?)`,
  ).run(id, businessId, name, glb, sizeKb * 1024, tris, now(), now())
  return id
}

const burgerModel = createModel(bitesId, 'Signature Burger', 'signature-burger.glb', 130, 9800)
const coffeeModel = createModel(bitesId, 'Cold Coffee', 'cold-coffee.glb', 35, 3100)
const pizzaModel = createModel(bitesId, 'Margherita Pizza', 'margherita-pizza.glb', 143, 11200)
const sneakerModel = createModel(threadsId, 'Classic Sneaker', 'classic-sneaker.glb', 36, 2600)
const chairModel = createModel(threadsId, 'Lounge Chair', 'lounge-chair.glb', 29, 1900)

/* ── categories + products ──────────────────────────────────────────────── */

function createCategory(businessId, name, slug, sortOrder) {
  const id = uuid()
  db.prepare(
    `INSERT INTO menu_categories (id, business_id, name, slug, sort_order, is_published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, businessId, name, slug, sortOrder, now(), now())
  return id
}

const catBurgers = createCategory(bitesId, 'Burgers', 'burgers', 0)
const catPizza = createCategory(bitesId, 'Pizza', 'pizza', 1)
const catDrinks = createCategory(bitesId, 'Drinks', 'drinks', 2)
const catFootwear = createCategory(threadsId, 'Footwear', 'footwear', 0)
const catHome = createCategory(threadsId, 'Home', 'home', 1)

function createProduct(businessId, p) {
  const id = uuid()
  db.prepare(
    `INSERT INTO products
       (id, business_id, category_id, model_id, name, slug, description, short_description,
        price_minor, compare_at_minor, currency,
        dim_width, dim_height, dim_depth, dim_unit,
        placement, scale_multiplier, ar_enabled, cta_label, cta_url,
        status, is_featured, is_bestseller, is_available, sort_order, diet, tags, allergens,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, 'cm', ?, 1, 1, ?, ?, 'published', ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, businessId, p.categoryId, p.modelId, p.name, p.slug, p.description, p.short,
    p.price, p.compareAt ?? null,
    p.w, p.h, p.d, p.placement,
    p.ctaLabel, p.ctaUrl,
    p.featured ? 1 : 0, p.bestseller ? 1 : 0, p.sortOrder,
    p.diet ?? null, JSON.stringify(p.tags ?? []), JSON.stringify(p.allergens ?? []),
    now(), now(),
  )
  return id
}

const burgerId = createProduct(bitesId, {
  categoryId: catBurgers, modelId: burgerModel,
  name: 'Signature Burger', slug: 'signature-burger',
  description: 'Double-stacked beef patty, aged cheddar, house pickles and burger sauce in a toasted brioche bun.',
  short: 'Double patty, aged cheddar, house sauce.',
  price: 34900, compareAt: 39900,
  w: 14.5, h: 9.9, d: 14.5, placement: 'tabletop',
  ctaLabel: 'Order Now', ctaUrl: 'https://example.com/urban-bites/order',
  featured: true, bestseller: true, sortOrder: 0, diet: 'non-veg',
  tags: ['bestseller', 'signature'], allergens: ['gluten', 'dairy'],
})

const pizzaId = createProduct(bitesId, {
  categoryId: catPizza, modelId: pizzaModel,
  name: 'Margherita Pizza', slug: 'margherita-pizza',
  description: 'San Marzano tomato, fior di latte, fresh basil and cold-pressed olive oil on a 24-hour fermented base.',
  short: 'San Marzano, fior di latte, fresh basil.',
  price: 49500,
  w: 30.4, h: 2.4, d: 30.4, placement: 'tabletop',
  ctaLabel: 'Order Now', ctaUrl: 'https://example.com/urban-bites/order',
  featured: true, bestseller: false, sortOrder: 1, diet: 'veg',
  tags: ['vegetarian'], allergens: ['gluten', 'dairy'],
})

const coffeeId = createProduct(bitesId, {
  categoryId: catDrinks, modelId: coffeeModel,
  name: 'Cold Coffee', slug: 'cold-coffee',
  description: 'Double-shot cold brew shaken with milk and a whisper of jaggery, served over ice.',
  short: 'Cold brew, milk, jaggery, over ice.',
  price: 24900,
  w: 8.3, h: 19.9, d: 8.3, placement: 'tabletop',
  ctaLabel: 'Order Now', ctaUrl: 'https://example.com/urban-bites/order',
  featured: false, bestseller: true, sortOrder: 2, diet: 'veg',
  tags: ['cold'], allergens: ['dairy'],
})

const sneakerId = createProduct(threadsId, {
  categoryId: catFootwear, modelId: sneakerModel,
  name: 'Classic Sneaker', slug: 'classic-sneaker',
  description: 'Low-profile court silhouette in navy suede with a vulcanised rubber sole.',
  short: 'Navy suede, vulcanised sole.',
  price: 449900, compareAt: 549900,
  w: 28.2, h: 10.8, d: 10, placement: 'floor',
  ctaLabel: 'Buy Now', ctaUrl: 'https://example.com/urban-threads/shop',
  featured: true, bestseller: true, sortOrder: 0,
  tags: ['new'],
})

const chairId = createProduct(threadsId, {
  categoryId: catHome, modelId: chairModel,
  name: 'Lounge Chair', slug: 'lounge-chair',
  description: 'Solid teak frame with a deep sage upholstered seat. Made to order in Bengaluru.',
  short: 'Teak frame, sage upholstery.',
  price: 1899900,
  w: 69, h: 93.5, d: 61.4, placement: 'floor',
  ctaLabel: 'Shop Now', ctaUrl: 'https://example.com/urban-threads/shop',
  featured: false, bestseller: false, sortOrder: 1,
})
console.log('✓ models + products')

/* ── QR codes ───────────────────────────────────────────────────────────── */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
function token(len = 16) {
  const bytes = randomBytes(len)
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('')
}

function createQr(businessId, productId, label, campaign) {
  const id = uuid()
  const t = token()
  db.prepare(
    `INSERT INTO qr_codes (id, business_id, product_id, token, label, destination, campaign, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ar', ?, 1, ?, ?)`,
  ).run(id, businessId, productId, t, label, campaign ?? null, now(), now())
  return { id, token: t }
}

const qrBurger = createQr(bitesId, burgerId, 'Table tent — Burgers', 'table-tent')
const qrPizza = createQr(bitesId, pizzaId, 'Menu insert — Pizza', 'menu-insert')
const qrCoffee = createQr(bitesId, coffeeId, 'Counter card — Cold Coffee', 'counter')
const qrSneaker = createQr(threadsId, sneakerId, 'Shelf label — Sneaker', 'in-store')
const qrChair = createQr(threadsId, chairId, 'Catalog page 12', 'catalog')
console.log('✓ QR codes')

/* ── analytics ──────────────────────────────────────────────────────────── */

/**
 * Six weeks of plausible funnel data. Each stage is a strict subset of the one
 * before, so the funnel chart is internally consistent rather than random.
 */
const DEVICES = [
  ['mobile', 'Safari', 'iOS'], ['mobile', 'Chrome', 'Android'],
  ['mobile', 'Safari', 'iOS'], ['mobile', 'Chrome', 'Android'],
  ['desktop', 'Chrome', 'macOS'], ['tablet', 'Safari', 'iOS'],
]

let seedN = 12345
function rand() {
  seedN = (seedN * 1103515245 + 12345) & 0x7fffffff
  return seedN / 0x7fffffff
}

const insertEvent = db.prepare(
  `INSERT INTO analytics_events
     (id, business_id, product_id, qr_code_id, event_type, device_type, browser, os, ar_tier, campaign, session_key, created_at, day)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

function seedEvents(businessId, entries, days) {
  let total = 0
  for (let d = days; d >= 0; d--) {
    const date = daysFromNow(-d)
    const dayKey = day(date)
    // Weekends run hotter for a restaurant.
    const weekend = [0, 6].includes(date.getUTCDay())
    for (const { productId, qrId, base } of entries) {
      const scans = Math.max(0, Math.round(base * (weekend ? 1.5 : 1) * (0.6 + rand() * 0.9)))
      for (let i = 0; i < scans; i++) {
        const [deviceType, browser, os] = DEVICES[Math.floor(rand() * DEVICES.length)]
        const session = uuid()
        const tier = os === 'iOS' ? 'quicklook' : deviceType === 'desktop' ? 'viewer' : 'webxr'
        const at = new Date(date.getTime() + Math.floor(rand() * 86_400_000)).toISOString()

        const emit = (type) => {
          insertEvent.run(uuid(), businessId, productId, qrId, type, deviceType, browser, os, tier, null, session, at, dayKey)
          total++
        }

        emit('qr_scanned')
        emit('product_loaded')
        if (rand() < 0.82) emit('viewer_3d_opened')
        else continue
        if (rand() < 0.46 && deviceType !== 'desktop') emit('ar_clicked')
        else continue
        if (rand() < 0.78) emit('ar_session_started')
        else continue
        if (rand() < 0.65) emit('ar_object_placed')
        if (rand() < 0.31) emit('cta_clicked')
      }
    }
  }
  return total
}

const bitesEvents = seedEvents(bitesId, [
  { productId: burgerId, qrId: qrBurger.id, base: 9 },
  { productId: pizzaId, qrId: qrPizza.id, base: 6 },
  { productId: coffeeId, qrId: qrCoffee.id, base: 4 },
], 42)

const threadsEvents = seedEvents(threadsId, [
  { productId: sneakerId, qrId: qrSneaker.id, base: 4 },
  { productId: chairId, qrId: qrChair.id, base: 2 },
], 21)

/* Keep the denormalised scan counters consistent with the events just written. */
for (const [qrId] of [[qrBurger.id], [qrPizza.id], [qrCoffee.id], [qrSneaker.id], [qrChair.id]]) {
  db.prepare(
    `UPDATE qr_codes SET
       scan_count = (SELECT COUNT(*) FROM analytics_events WHERE qr_code_id = ? AND event_type = 'qr_scanned'),
       last_scan_at = (SELECT MAX(created_at) FROM analytics_events WHERE qr_code_id = ?)
     WHERE id = ?`,
  ).run(qrId, qrId, qrId)
}
console.log(`✓ analytics (${bitesEvents + threadsEvents} events)`)

/* ── invoices ───────────────────────────────────────────────────────────── */

let invoiceSeq = 1
function createInvoice(businessId, subscriptionId, opts) {
  const id = uuid()
  const number = `INV-2026-${String(invoiceSeq++).padStart(4, '0')}`
  const subtotal = opts.items.reduce((s, i) => s + i.amount, 0)
  const taxPercent = opts.taxPercent ?? 18
  const discount = opts.discount ?? 0
  const taxable = subtotal - discount
  const tax = Math.round((taxable * taxPercent) / 100)
  const total = taxable + tax

  db.prepare(
    `INSERT INTO invoices
       (id, business_id, subscription_id, number, status, currency, subtotal_minor,
        discount_minor, tax_minor, total_minor, paid_minor, tax_name, tax_percent,
        issue_date, due_date, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'GST', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, businessId, subscriptionId, number, opts.status, subtotal, discount, tax, total,
    opts.paid ?? 0, taxPercent, opts.issueDate, opts.dueDate, opts.paidAt ?? null,
    opts.issueDate, now(),
  )

  opts.items.forEach((item, idx) => {
    db.prepare(
      `INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_minor, amount_minor, kind, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(uuid(), id, item.description, item.qty ?? 1, item.amount / (item.qty ?? 1), item.amount, item.kind, idx)
  })

  if (opts.paid && opts.paid > 0) {
    db.prepare(
      `INSERT INTO payments (id, business_id, invoice_id, amount_minor, currency, method, reference, paid_at, recorded_by, created_at)
       VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?)`,
    ).run(uuid(), businessId, id, opts.paid, opts.method ?? 'upi', opts.reference ?? null, opts.paidAt ?? opts.dueDate, adminId, now())
  }
  return id
}

// Urban Bites: setup fee + three months, all paid, current month outstanding.
createInvoice(bitesId, bitesSubId, {
  status: 'paid', issueDate: iso(daysFromNow(-96)), dueDate: iso(daysFromNow(-89)),
  paidAt: iso(daysFromNow(-92)), method: 'bank_transfer', reference: 'NEFT-8871',
  items: [
    { description: 'AR setup — 3 models', amount: 99900, kind: 'setup_fee' },
    { description: 'Growth plan — first month (negotiated)', amount: 149900, kind: 'subscription' },
  ],
  paid: 294582,
})
for (const m of [2, 1]) {
  createInvoice(bitesId, bitesSubId, {
    status: 'paid', issueDate: iso(daysFromNow(-30 * m)), dueDate: iso(daysFromNow(-30 * m + 7)),
    paidAt: iso(daysFromNow(-30 * m + 3)), method: 'upi', reference: `UPI-${4400 + m}`,
    items: [{ description: 'Growth plan — monthly (negotiated)', amount: 149900, kind: 'subscription' }],
    paid: 176882,
  })
}
// Outstanding: partly paid and past due — drives the overdue dashboard tile.
createInvoice(bitesId, bitesSubId, {
  status: 'partial', issueDate: iso(daysFromNow(-9)), dueDate: iso(daysFromNow(-2)),
  method: 'upi', reference: 'UPI-4402',
  items: [{ description: 'Growth plan — monthly (negotiated)', amount: 149900, kind: 'subscription' }],
  paid: 80000,
})
// Urban Threads: trial, one setup invoice awaiting payment.
createInvoice(threadsId, threadsSubId, {
  status: 'sent', issueDate: iso(daysFromNow(-4)), dueDate: iso(daysFromNow(3)),
  items: [{ description: 'AR setup — 2 models', amount: 99900, kind: 'setup_fee' }],
})
console.log('✓ invoices + payments')

/* ── coupons + promotions ───────────────────────────────────────────────── */

db.prepare(
  `INSERT INTO coupons (id, code, description, discount_type, discount_value, duration,
     applicable_plans, expires_at, max_redemptions, per_business_limit, redemption_count, is_active, created_at, updated_at)
   VALUES (?, 'WELCOME500', 'Flat ₹500 off the first invoice', 'fixed', 50000, 'once', NULL, ?, 100, 1, 3, 1, ?, ?)`,
).run(uuid(), iso(daysFromNow(90)), now(), now())

db.prepare(
  `INSERT INTO coupons (id, code, description, discount_type, discount_value, duration,
     applicable_plans, expires_at, max_redemptions, per_business_limit, redemption_count, is_active, created_at, updated_at)
   VALUES (?, 'FESTIVE30', '30% off for the festive season', 'percentage', 30, 'once', NULL, ?, 50, 1, 0, 1, ?, ?)`,
).run(uuid(), iso(daysFromNow(30)), now(), now())

db.prepare(
  `INSERT INTO promotions (id, name, description, discount_type, discount_value, coupon_code,
     starts_at, ends_at, banner_title, banner_message, banner_cta_label, banner_cta_url,
     banner_color, show_banner, is_active, created_at, updated_at)
   VALUES (?, 'Independence Day Offer', '30% off AR setup', 'percentage', 30, 'FESTIVE30',
     ?, ?, 'Independence Day Offer', 'Get 30% OFF your AR setup this week.', 'Claim offer', '/pricing',
     '#e8623c', 1, 1, ?, ?)`,
).run(uuid(), iso(daysFromNow(-3)), iso(daysFromNow(11)), now(), now())
console.log('✓ coupons + promotions')

/* ── reminder rules ─────────────────────────────────────────────────────── */

const RULES = [
  [-7, 'Due in 7 days', 'Your subscription payment is due in 7 days', 'Invoice {{number}} for {{amount}} is due on {{due_date}}.'],
  [-3, 'Due in 3 days', 'Your subscription payment is due in 3 days', 'Invoice {{number}} for {{amount}} is due on {{due_date}}.'],
  [0, 'Due today', 'Your subscription payment is due today', 'Invoice {{number}} for {{amount}} is due today.'],
  [3, 'Overdue', 'Your payment is overdue', 'Invoice {{number}} for {{amount}} was due on {{due_date}}.'],
  [7, 'Suspension warning', 'Your service may be suspended', 'Invoice {{number}} is 7 days overdue. Service may be suspended unless payment is received.'],
]
RULES.forEach(([offset, name, subject, body], i) => {
  db.prepare(
    `INSERT INTO reminder_rules (id, name, offset_days, subject, body, channel, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'in_app', 1, ?, ?, ?)`,
  ).run(uuid(), name, offset, subject, body, i, now(), now())
})
console.log('✓ reminder rules')

/* ── CRM ────────────────────────────────────────────────────────────────── */

const LEADS = [
  ['Kavya Reddy', 'Spice Route', 'restaurant', 'Hyderabad', 'negotiation', 199900, 'instagram', 2],
  ['Rohit Sharma', 'The Daily Grind', 'cafe', 'Pune', 'demo_completed', 99900, 'referral', 5],
  ['Ananya Iyer', 'Bloom Bakery', 'bakery', 'Chennai', 'proposal_sent', 199900, 'walk-in', 3],
  ['Vikram Singh', 'Nomad Furniture', 'furniture', 'Jaipur', 'contacted', 399900, 'website', 8],
  ['Meera Joshi', 'Lush Living', 'furniture', 'Mumbai', 'new', 199900, 'instagram', 1],
  ['Sanjay Gupta', 'Sole Society', 'footwear', 'Delhi', 'demo_scheduled', 199900, 'cold-call', 4],
  ['Nisha Patel', 'Aura Jewels', 'jewelry', 'Surat', 'won', 399900, 'referral', 20],
  ['Imran Khan', 'Grill House', 'restaurant', 'Kolkata', 'lost', 99900, 'website', 30],
]

LEADS.forEach(([name, businessName, type, city, stage, value, source, ageDays], i) => {
  const id = uuid()
  db.prepare(
    `INSERT INTO crm_leads
       (id, name, business_name, business_type, phone, email, city, source, stage,
        expected_value_minor, assigned_to, next_follow_up_at, last_contact_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, name, businessName, type,
    `+91 9${String(80000000 + i * 111111).slice(0, 9)}`,
    `${name.split(' ')[0].toLowerCase()}@${businessName.toLowerCase().replace(/\W+/g, '')}.local`,
    city, source, stage, value, adminId,
    ['won', 'lost'].includes(stage) ? null : iso(daysFromNow((i % 5) + 1)),
    iso(daysFromNow(-ageDays)), i, iso(daysFromNow(-ageDays - 5)), now(),
  )

  db.prepare(`INSERT INTO crm_notes (id, lead_id, author_id, body, created_at) VALUES (?,?,?,?,?)`)
    .run(uuid(), id, adminId, `Initial call — interested in AR for their ${type}. Sent the demo link.`, iso(daysFromNow(-ageDays)))

  db.prepare(`INSERT INTO crm_activities (id, lead_id, actor_id, action, from_value, to_value, created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uuid(), id, adminId, 'stage_changed', 'new', stage, iso(daysFromNow(-ageDays + 1)))

  if (!['won', 'lost'].includes(stage)) {
    db.prepare(`INSERT INTO crm_tasks (id, lead_id, title, due_at, assigned_to, created_at) VALUES (?,?,?,?,?,?)`)
      .run(uuid(), id, `Follow up with ${businessName}`, iso(daysFromNow((i % 5) + 1)), adminId, now())
  }
})
console.log('✓ CRM leads')

/* ── platform settings + CMS ────────────────────────────────────────────── */

function setSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`)
    .run(key, JSON.stringify(value), now())
}

setSetting('branding', {
  name: 'ARView Commerce',
  tagline: 'Turn your products into interactive AR experiences',
  logoUrl: null,
  faviconEmoji: '📦',
  primaryColor: '#5b3df5',
  supportEmail: 'support@arview.local',
  supportPhone: '+91 98200 00000',
})

// Everything requiring a paid third party is OFF by default. Nothing here can
// start billing anyone by surprise.
setSetting('feature_flags', {
  model_generation: false,
  payments: false,
  whatsapp: false,
  voice_calling: false,
  marker_ar: false,
  white_label: false,
  custom_domain: false,
  advanced_analytics: true,
  pwa: false,
})

setSetting('tax', { enabled: true, name: 'GST', percent: 18, taxId: '' })
setSetting('billing', { gracePeriodDays: 7, autoSuspend: false, invoicePrefix: 'INV-2026-' })

const CMS = [
  ['landing_hero', {
    heading: 'Turn Your Products Into Interactive AR Experiences',
    subheading: 'Let customers see your products in 3D and in their real environment — directly from a QR code.',
    primaryCta: { label: 'Start Your Business', href: '/signup' },
    secondaryCta: { label: 'View Demo', href: '/ar/urban-bites/signature-burger' },
  }],
  ['landing_features', {
    items: [
      { title: 'Scan to experience', body: 'A QR on the table opens a 3D product instantly. No app, no signup.' },
      { title: 'True-to-life scale', body: 'Products appear at their real physical size on the customer’s table or floor.' },
      { title: 'Works across devices', body: 'WebXR, Android Scene Viewer and iOS AR Quick Look, with a 3D fallback everywhere else.' },
      { title: 'Know what converts', body: 'Track scans, AR sessions and order clicks per product.' },
    ],
  }],
  ['faq', {
    items: [
      { q: 'Do customers need an app?', a: 'No. They scan the QR and the experience opens in their browser.' },
      { q: 'Does AR work on every phone?', a: 'AR availability depends on the device and browser. Where AR is unavailable the product still opens in an interactive 3D viewer.' },
      { q: 'Who creates the 3D models?', a: 'You can upload your own GLB files, or we can produce them for a one-time setup fee.' },
      { q: 'How do I pay?', a: 'We invoice you directly. Bank transfer, UPI or cash — no card required.' },
    ],
  }],
  ['footer', {
    tagline: 'AR commerce for restaurants, cafés and retail brands.',
    columns: [
      { title: 'Product', links: [{ label: 'Features', href: '/#features' }, { label: 'Pricing', href: '/pricing' }, { label: 'Demo', href: '/ar/urban-bites/signature-burger' }] },
      { title: 'Legal', links: [{ label: 'Privacy', href: '/legal/privacy' }, { label: 'Terms', href: '/legal/terms' }, { label: 'Refunds', href: '/legal/refunds' }] },
    ],
  }],
]
CMS.forEach(([key, content], i) => {
  db.prepare(`INSERT OR REPLACE INTO cms_sections (id, key, content, is_active, sort_order, updated_at) VALUES (?,?,?,1,?,?)`)
    .run(uuid(), key, JSON.stringify(content), i, now())
})
console.log('✓ settings + CMS')

/* ── notifications ──────────────────────────────────────────────────────── */

db.prepare(
  `INSERT INTO notifications (id, business_id, user_id, title, body, kind, link_url, created_at)
   VALUES (?, ?, ?, ?, ?, 'billing', '/dashboard/billing', ?)`,
).run(uuid(), bitesId, bitesOwnerId, 'Payment overdue',
  'Invoice INV-2026-0004 is past its due date. A partial payment has been recorded.', now())

db.prepare(
  `INSERT INTO notifications (id, business_id, user_id, title, body, kind, link_url, created_at)
   VALUES (?, ?, ?, ?, ?, 'info', '/dashboard/products', ?)`,
).run(uuid(), threadsId, threadsOwnerId, 'Your trial ends in 6 days',
  'Add a plan to keep your AR products live after the trial.', now())

/* ── done ───────────────────────────────────────────────────────────────── */

const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

console.log(`
────────────────────────────────────────────────────────────────
  Seed complete.

  SUPER ADMIN        ${origin}/admin/login
    ${ADMIN_EMAIL}
    ${ADMIN_PASSWORD}

  BUSINESS (Urban Bites — restaurant, Growth plan)
                     ${origin}/login
    owner@urbanbites.local
    ${DEMO_PASSWORD}

  BUSINESS (Urban Threads — clothing, on trial)
    owner@urbanthreads.local
    ${DEMO_PASSWORD}

  PUBLIC AR — no login required
    ${origin}/ar/urban-bites/signature-burger
    ${origin}/ar/urban-bites/margherita-pizza
    ${origin}/ar/urban-threads/classic-sneaker
    ${origin}/ar/urban-threads/lounge-chair

  QR REDIRECTS (what the printed codes encode)
    ${origin}/r/${qrBurger.token}
    ${origin}/r/${qrPizza.token}
    ${origin}/r/${qrSneaker.token}
────────────────────────────────────────────────────────────────
`)

db.close()
