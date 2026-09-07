// tests/live/consult-capture-gate.test.ts
//
// The live half of the CAPTURE GATE — the one live suite that did not exist.
//
// 🔴 Why it exists. On 2026-09-07 the colour policy changed (prompt
// `full-analysis-capture-v4`): warm light and colour cast stopped REFUSING a
// photo on every shot, and hard rejection was narrowed to a frame that cannot
// be READ. Every capture test in this repo mocks the provider, and
// `tests/live/` covered only the ANALYSIS schemas — so nothing anywhere had
// ever sent a real image to `checkConsultCapture`. The whole of v4's risk sits
// in one sentence of prompt ("judge dark and bright by LEGIBILITY, not
// preference") and no mock can tell you whether the model honours it.
//
// The dark-frame case is the load-bearing one. Loosening the colour rule is
// only safe if the exposure floor still holds; if that test ever starts
// PASSING an image through, v4 has become permissive and the gate is doing
// nothing. The two required-success cases are its control: without them, a gate
// that refused everything would also look "safe".
//
// Images are SYNTHETIC, from eval/consult/hair-color/v1 (openai-imagegen,
// deidentified, `containsRealClientCapture: false`, permitted for repository
// AI evaluation). Production media is clients' private session photographs and
// must never be sent from this repo.
//
// Costs money and needs ANTHROPIC_API_KEY. Not a PR gate.
// `pnpm test:live:consult-capture-gate`.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CONSULT_CAPTURE_QUALITY_PROMPT_VERSION,
  checkConsultCapture,
  consultCaptureQualityPromptVersion,
} from '@/lib/consult/captureVision'

const FIXTURES = path.resolve(
  __dirname,
  '../../eval/consult/hair-color/v1/fixtures',
)

/**
 * 🔴 Only the four `hair_*` fixtures are real 512×512 generated photographs.
 * The `face_front` / `face_side` / `eyes_closeup` entries in that set are a
 * single 64×64, 1,866-byte PLACEHOLDER shared by all three — verified by md5 —
 * so there is no real face or eyes fixture in this repo to assert success on.
 * The tight-crop case below is therefore DERIVED from a hair fixture rather
 * than pretending a stub is a close-up.
 */
async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES, name))
}

/** A centre crop blown back up: the subject fills the frame, no background. */
async function tightCrop(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .extract({ left: 160, top: 160, width: 192, height: 192 })
    .resize(768, 768, { kernel: 'lanczos3' })
    .jpeg({ quality: 92 })
    .toBuffer()
}

/**
 * Crushed to near-black: gamma down and a hard linear cut. Deliberately not
 * "a bit dim" — this is the frame a client takes in an unlit room at night,
 * the one the gate must still refuse whatever the colour rule says.
 */
async function crushExposure(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .linear(0.06, 0)
    .modulate({ brightness: 0.35 })
    .jpeg({ quality: 88 })
    .toBuffer()
}

/** Mean luma, so the report can state HOW dark the dark frame actually is. */
async function meanLuma(buffer: Buffer): Promise<number> {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let total = 0
  for (const value of data) total += value
  return total / (info.width * info.height)
}

function report(label: string, verdict: Awaited<ReturnType<typeof checkConsultCapture>>) {
  console.info(
    `[capture-gate] ${label} → accepted=${verdict.accepted} reason=${verdict.reasonCode} ` +
      `warning=${verdict.warningCode ?? 'none'} tip=${verdict.retakeTip ?? 'none'}`,
  )
}

beforeAll(() => {
  // Fail, never skip — a skipped live test is exactly the green-suite /
  // broken-contract state this directory exists to make impossible.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'tests/live needs ANTHROPIC_API_KEY. This suite makes real provider calls by design.',
    )
  }
})

describe('the capture gate against the live model (v4)', () => {
  it('stores v4 as the prompt version for a guided shot', () => {
    expect(consultCaptureQualityPromptVersion('hair_back')).toBe(
      'full-analysis-capture-v4',
    )
    expect(CONSULT_CAPTURE_QUALITY_PROMPT_VERSION).toBe('full-analysis-capture-v4')
  })

  // ── Required success: FULL VIEW ────────────────────────────────────────
  // The path v4 actually changed. Before it, a warm reading here was a hard
  // refusal; now it must accept, with or without a colour warning.
  it.each(['hair_back', 'hair_crown'] as const)(
    'ACCEPTS a well-formed full view (%s)',
    async (shotKey) => {
      const image = await fixture(`synthetic-i-${shotKey}.jpg`)
      const verdict = await checkConsultCapture({
        shotKey,
        image: { base64: image.toString('base64'), mediaType: 'image/jpeg' },
      })
      report(`full-view ${shotKey}`, verdict)
      expect(verdict.accepted).toBe(true)
      expect(verdict.reasonCode).toBe('PASS')
      // A colour warning is allowed and expected on indoor-looking frames; a
      // refusal is not. `retakeTip` is always dropped on an acceptance.
      expect(verdict.retakeTip).toBeNull()
      if (verdict.warningCode !== null) {
        expect(['WARM_INDOOR_LIGHT', 'COLOR_CAST']).toContain(verdict.warningCode)
      }
    },
  )

  // ── Required success: TIGHT CROP ───────────────────────────────────────
  it('ACCEPTS a tight crop where the subject fills the frame', async () => {
    const image = await tightCrop(await fixture('synthetic-i-hair_back.jpg'))
    const verdict = await checkConsultCapture({
      // area_closeup is the AREA pack's TIGHT_CROP shot: "a patch filling the
      // frame". eyes_closeup would need a real eyes photograph, which this
      // repo does not have.
      shotKey: 'area_closeup',
      image: { base64: image.toString('base64'), mediaType: 'image/jpeg' },
    })
    report('tight-crop area_closeup', verdict)
    expect(verdict.accepted).toBe(true)
    expect(verdict.reasonCode).toBe('PASS')
    expect(verdict.retakeTip).toBeNull()
  })

  // ── Required refusal: a genuinely dark frame ───────────────────────────
  // 🔴 THE load-bearing test. v4 tells the model to judge exposure by
  // legibility rather than preference. If that sentence is too weak, this
  // starts passing and the gate has stopped gating.
  it('still REFUSES a genuinely dark frame', async () => {
    const source = await fixture('synthetic-i-hair_back.jpg')
    const dark = await crushExposure(source)
    const [before, after] = await Promise.all([meanLuma(source), meanLuma(dark)])
    console.info(
      `[capture-gate] dark frame mean luma ${before.toFixed(1)} → ${after.toFixed(1)} / 255`,
    )
    expect(after).toBeLessThan(20)

    const verdict = await checkConsultCapture({
      shotKey: 'hair_back',
      image: { base64: dark.toString('base64'), mediaType: 'image/jpeg' },
    })
    report('dark hair_back', verdict)
    expect(verdict.accepted).toBe(false)
    expect(verdict.warningCode).toBeNull()
    // TOO_DARK is the expected code, but any unreadable-frame refusal is a
    // correct outcome here; a colour code would NOT be, because v4 downgrades
    // those to warnings and the frame would have been accepted.
    expect([
      'TOO_DARK',
      'SUBJECT_NOT_VISIBLE',
      'VIEW_MISMATCH',
      'HAIR_NOT_VISIBLE',
      'BLURRY',
      'OTHER_QUALITY_FAILURE',
    ]).toContain(verdict.reasonCode)
    expect(verdict.retakeTip).toBeTruthy()
  })
})
