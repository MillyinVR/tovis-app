// lib/services/consultFacts.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { consultFactsConflict, CONSULT_FACT_FIELDS, CONSULT_FACT_LABELS } from './consultFacts'

describe('a service that lightens is chemical work', () => {
  it('refuses the pair that would hide chemistry, in words an admin can act on', () => {
    const message = consultFactsConflict({ maxLiftLevels: 4, isChemical: false })
    expect(message).toBeTruthy()
    expect(message).toContain('chemical')
  })

  it('allows the honest combinations', () => {
    // Lightens, and says so.
    expect(consultFactsConflict({ maxLiftLevels: 4, isChemical: true })).toBeNull()
    // Chemical but deposit-only — a toner, a relaxer.
    expect(consultFactsConflict({ maxLiftLevels: 0, isChemical: true })).toBeNull()
    // Neither — a cut, a blowout.
    expect(consultFactsConflict({ maxLiftLevels: 0, isChemical: false })).toBeNull()
    // Not yet known: it makes no claim, so there is nothing to contradict.
    expect(consultFactsConflict({ maxLiftLevels: null, isChemical: false })).toBeNull()
  })

  it('every field the admin form posts has a label and a help line', () => {
    for (const field of CONSULT_FACT_FIELDS) {
      expect(CONSULT_FACT_LABELS[field]?.label, field).toBeTruthy()
      expect(CONSULT_FACT_LABELS[field]?.help, field).toBeTruthy()
    }
  })
})

/**
 * 🔴 The authored data itself, checked as data.
 *
 * These 77 rows are hand-written domain facts that drive a safety-relevant
 * diagnosis, and a mistake in one of them is not a crash — it is a plan built
 * on a wrong belief. The database CHECK catches the lift/chemical pair at
 * write time; this catches it while the file is still being edited, and names
 * the service.
 */
describe('the authored service facts', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'data', 'service-consult-facts.sql'),
    'utf8',
  )
  // One row per VALUES line: ('Name','summary',lift,tone,chem,shape,len,'limits')
  const rows = [...sql.matchAll(
    /^\s*\('((?:[^']|'')+)','((?:[^']|'')*)',(\d+),(true|false),(true|false),(true|false),(true|false),'((?:[^']|'')*)'\)/gm,
  )].map((m) => ({
    name: m[1]!.replace(/''/g, "'"),
    summary: m[2]!,
    lift: Number(m[3]),
    tone: m[4] === 'true',
    chemical: m[5] === 'true',
    shape: m[6] === 'true',
    length: m[7] === 'true',
    limits: m[8]!,
  }))

  it('parses every authored row', () => {
    expect(rows.length).toBe(77)
    expect(new Set(rows.map((r) => r.name)).size).toBe(77)
  })

  it('never claims lightening without chemistry', () => {
    const offenders = rows.filter((r) => r.lift > 0 && !r.chemical).map((r) => r.name)
    expect(offenders).toEqual([])
  })

  it('keeps every lift within the range the database and the form allow', () => {
    const offenders = rows.filter((r) => r.lift < 0 || r.lift > 10).map((r) => r.name)
    expect(offenders).toEqual([])
  })

  it('says something real in both prose fields — no blanks, no placeholders', () => {
    for (const row of rows) {
      expect(row.summary.length, row.name).toBeGreaterThan(20)
      expect(row.limits.length, row.name).toBeGreaterThan(10)
      expect(row.summary.toLowerCase(), row.name).not.toContain('place holder')
      expect(row.limits.toLowerCase(), row.name).not.toContain('placeholder')
    }
  })

  it('keeps the deposit-only colour services at zero lift', () => {
    // 🔴 The single fact the feature turns on. If a toner ever reports a lift,
    // the consult will believe it can reach a lighter goal, and it cannot.
    for (const name of ['Toner', 'Gloss', 'Lowlights', 'Vivid Color', 'Root Smudge', 'Color Melt']) {
      const row = rows.find((r) => r.name === name)
      expect(row, name).toBeDefined()
      expect(row?.lift, name).toBe(0)
    }
  })

  it('keeps the lightening services able to lighten', () => {
    for (const name of ['Bleach & Tone', 'Full Head Highlight', 'Balayage', 'Babylights']) {
      const row = rows.find((r) => r.name === name)
      expect(row, name).toBeDefined()
      expect(row?.lift, name).toBeGreaterThan(0)
      expect(row?.chemical, name).toBe(true)
    }
  })
})
