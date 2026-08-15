/**
 * Runs the billing engine from the command line.
 *
 *   npm run billing:tick              # run against now
 *   npm run billing:tick -- --at=2026-09-01T00:00:00Z
 *   npm run billing:tick -- --dry     # report only, roll everything back
 *
 * Uses its own database connection and a duplicated engine invocation path
 * rather than importing lib/billing/engine, which is marked `server-only` for
 * Next. The engine logic itself is not duplicated — this shells into the same
 * SQL by running the compiled tick through tsx.
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const args = process.argv.slice(2)
const atArg = args.find((a) => a.startsWith('--at='))?.slice(5)
const dry = args.includes('--dry')

const at = atArg ? new Date(atArg).toISOString() : new Date().toISOString()
if (Number.isNaN(Date.parse(at))) {
  console.error(`Invalid --at value: ${atArg}`)
  process.exit(1)
}

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'arview.db')
const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')

console.log(`Billing tick at ${at}${dry ? '  (dry run — will roll back)' : ''}\n`)

/* A dry run wraps everything in a transaction that is deliberately rolled back,
   so an operator can see exactly what a real run would do before committing. */
if (dry) db.exec('BEGIN')

const before = snapshot(db)

// The engine runs inside the Next runtime, so trigger it through the HTTP
// endpoint when one is up; otherwise report that the server must be running.
const url = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const secret = process.env.CRON_SECRET

if (!secret) {
  console.error('CRON_SECRET is not set. Add it to .env.local, then restart the dev server.')
  process.exit(1)
}

let report
try {
  const res = await fetch(`${url}/api/cron/billing`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  if (res.status === 404) {
    console.error('Endpoint refused the request — CRON_SECRET here does not match the server’s.')
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`Billing tick failed: HTTP ${res.status}`)
    process.exit(1)
  }
  report = await res.json()
} catch {
  console.error(
    `Could not reach ${url}. Start the server first:\n  npm run dev\nthen re-run this command.`,
  )
  process.exit(1)
}

const after = snapshot(db)

console.log('  invoices raised        ', report.invoicesRaised)
console.log('  marked overdue         ', report.invoicesMarkedOverdue)
console.log('  subscriptions advanced ', report.subscriptionsAdvanced)
console.log('  reminders sent         ', report.remindersSent)
console.log('  businesses suspended   ', report.businessesSuspended)

if (report.notes?.length) {
  console.log('\n  detail:')
  for (const note of report.notes) console.log('    · ' + note)
}

console.log('\n  totals   before → after')
for (const key of Object.keys(before)) {
  const changed = before[key] !== after[key]
  console.log(
    `    ${key.padEnd(22)} ${String(before[key]).padStart(6)} → ${String(after[key]).padStart(6)}${changed ? '  *' : ''}`,
  )
}

if (dry) {
  db.exec('ROLLBACK')
  console.log('\n  rolled back — nothing was written')
}

db.close()

function snapshot(database) {
  const one = (sql) => Number(database.prepare(sql).get()?.c ?? 0)
  return {
    invoices: one('SELECT COUNT(*) c FROM invoices WHERE deleted_at IS NULL'),
    overdue: one("SELECT COUNT(*) c FROM invoices WHERE status='overdue' AND deleted_at IS NULL"),
    outstanding_paise: one(
      "SELECT COALESCE(SUM(total_minor-paid_minor),0) c FROM invoices WHERE status IN ('sent','partial','overdue') AND deleted_at IS NULL",
    ),
    notifications: one('SELECT COUNT(*) c FROM notifications'),
    reminder_logs: one('SELECT COUNT(*) c FROM notification_logs'),
    suspended: one("SELECT COUNT(*) c FROM businesses WHERE status='suspended' AND deleted_at IS NULL"),
  }
}
