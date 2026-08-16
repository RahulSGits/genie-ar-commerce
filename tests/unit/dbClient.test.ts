import { describe, expect, it } from 'vitest'
import { toPositional, normaliseRow } from '@/lib/db/client'

/**
 * The placeholder rewrite and row normalisation are the two places where the
 * Postgres adapter can silently corrupt data rather than fail. Both get tested
 * directly, because a bug in either produces plausible-looking wrong answers
 * everywhere at once.
 */

describe('toPositional', () => {
  it('numbers placeholders in order', () => {
    expect(toPositional('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    )
  })

  it('leaves SQL without placeholders untouched', () => {
    expect(toPositional('SELECT 1')).toBe('SELECT 1')
  })

  it('does not rewrite a question mark inside a string literal', () => {
    // The bug this prevents: naive replacement turns the literal into $1 and
    // shifts every real parameter by one, so `a` binds to what `b` meant.
    expect(toPositional(`SELECT * FROM t WHERE label = 'what?' AND a = ?`)).toBe(
      `SELECT * FROM t WHERE label = 'what?' AND a = $1`,
    )
  })

  it('handles escaped quotes inside a literal', () => {
    expect(toPositional(`SELECT 'it''s a ?' , ?`)).toBe(`SELECT 'it''s a ?' , $1`)
  })

  it('does not rewrite inside a double-quoted identifier', () => {
    expect(toPositional(`SELECT "weird?col" FROM t WHERE a = ?`)).toBe(
      `SELECT "weird?col" FROM t WHERE a = $1`,
    )
  })

  it('does not rewrite inside a line comment', () => {
    const sql = `SELECT a -- is this ?\nFROM t WHERE b = ?`
    expect(toPositional(sql)).toBe(`SELECT a -- is this ?\nFROM t WHERE b = $1`)
  })

  it('does not rewrite inside a block comment', () => {
    const sql = `SELECT a /* ? ? ? */ FROM t WHERE b = ?`
    expect(toPositional(sql)).toBe(`SELECT a /* ? ? ? */ FROM t WHERE b = $1`)
  })

  it('numbers correctly when literals and placeholders interleave', () => {
    expect(toPositional(`INSERT INTO t VALUES (?, 'a?b', ?, "c?d", ?)`)).toBe(
      `INSERT INTO t VALUES ($1, 'a?b', $2, "c?d", $3)`,
    )
  })
})

describe('normaliseRow', () => {
  it('converts Date to an ISO string', () => {
    // Every mapper reads timestamps with str(), which returns '' for a Date.
    // Without this conversion Postgres would blank every timestamp in the app.
    const row = normaliseRow({ created_at: new Date('2026-08-16T10:30:00.000Z') })
    expect(row['created_at']).toBe('2026-08-16T10:30:00.000Z')
  })

  it('converts bigint to number', () => {
    expect(normaliseRow({ total_minor: 149900n })['total_minor']).toBe(149900)
  })

  it('refuses a bigint that cannot survive as a number', () => {
    expect(() => normaliseRow({ total_minor: 9007199254740993n })).toThrow(/precision/)
  })

  it('passes through the types SQLite already returns', () => {
    const row = normaliseRow({ a: 'text', b: 42, c: null, d: true })
    expect(row).toEqual({ a: 'text', b: 42, c: null, d: true })
  })

  it('leaves a parsed jsonb object intact', () => {
    const row = normaliseRow({ limits: { maxProducts: 10 } })
    expect(row['limits']).toEqual({ maxProducts: 10 })
  })
})
