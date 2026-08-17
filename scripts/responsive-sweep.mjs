/**
 * Responsive sweep: renders each route at three widths and reports any element
 * that bleeds outside the viewport without a scroll container around it.
 *
 * Uses Playwright, which is already a dev dependency for the E2E suite, so
 * there is nothing new to install.
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://localhost:50555'
const EMAIL = process.env.EMAIL
const PASSWORD = process.env.PASSWORD

const WIDTHS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
]

const PUBLIC_ROUTES = [
  '/',
  '/pricing',
  '/login',
  '/signup',
  '/ar/urban-bites',
  '/ar/urban-bites/signature-burger',
  '/ar/urban-threads/lounge-chair',
  '/legal/privacy',
  '/qr-not-found',
]

const DASH_ROUTES = [
  '/dashboard',
  '/dashboard/create',
  '/dashboard/products',
  '/dashboard/collections',
  '/dashboard/campaigns',
  '/dashboard/models',
  '/dashboard/qr',
  '/dashboard/analytics',
  '/dashboard/import',
  '/dashboard/business',
  '/dashboard/brand',
  '/dashboard/team',
  '/dashboard/developers',
  '/dashboard/billing',
  '/dashboard/settings',
  '/dashboard/support',
  '/dashboard/search?q=burger',
]

const AUDIT = () => {
  const doc = document.documentElement
  const vw = doc.clientWidth

  /*
    Whether the page really scrolls sideways is tested by trying to scroll it,
    not by comparing scrollWidth to clientWidth.

    `documentElement.scrollWidth` reports the widest scrollable DESCENDANT's
    content, so a correctly-contained `overflow-x: auto` table — which is the
    right way to show a wide table on a phone — makes it report 642 on a 375px
    viewport while the page itself cannot be panned at all. That produced two
    false positives on the first run and nearly sent me refactoring layouts
    that were already correct.
  */
  const beforeX = window.scrollX
  window.scrollTo(vw * 2, window.scrollY)
  const panned = window.scrollX > 0
  window.scrollTo(beforeX, window.scrollY)
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    return false
  }
  const bleeding = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
      const k = el.tagName + String(el.className)
      if (!seen.has(k)) {
        seen.add(k)
        bleeding.push(`${el.tagName}.${String(el.className || '').split(' ').slice(0, 3).join('.')} → ${Math.round(r.right)}px`)
      }
    }
  }
  return { sideways: panned, bleeding: bleeding.slice(0, 4) }
}

const browser = await chromium.launch()
const problems = []
let checked = 0

for (const size of WIDTHS) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
  const page = await context.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))

  let routes = PUBLIC_ROUTES
  if (EMAIL && PASSWORD) {
    await page.goto(`${BASE}/login`, { waitUntil: 'load' })
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PASSWORD)
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 }).catch(() => {}),
      page.click('button[type=submit]'),
    ])
    routes = [...PUBLIC_ROUTES, ...DASH_ROUTES]
  }

  for (const route of routes) {
    errors.length = 0
    try {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 25000 })
      await page.waitForTimeout(400)
      const status = response?.status() ?? 0
      if (status >= 400) {
        problems.push(`${size.name.padEnd(7)} ${route.padEnd(38)} HTTP ${status}`)
        continue
      }
      const result = await page.evaluate(AUDIT)
      checked++
      if (result.sideways) {
        problems.push(`${size.name.padEnd(7)} ${route.padEnd(38)} page scrolls sideways`)
      }
      for (const b of result.bleeding) {
        problems.push(`${size.name.padEnd(7)} ${route.padEnd(38)} bleeds: ${b}`)
      }
      for (const e of errors) {
        problems.push(`${size.name.padEnd(7)} ${route.padEnd(38)} JS error: ${e}`)
      }
    } catch (err) {
      problems.push(`${size.name.padEnd(7)} ${route.padEnd(38)} FAILED: ${String(err).split('\n')[0].slice(0, 80)}`)
    }
  }
  await context.close()
}

await browser.close()

console.log(`\n  Checked ${checked} page renders across ${WIDTHS.length} widths\n`)
if (problems.length === 0) {
  console.log('  No layout overflow, HTTP errors or runtime errors.\n')
} else {
  for (const p of problems) console.log(`  ${p}`)
  console.log(`\n  ${problems.length} problem(s)\n`)
}
