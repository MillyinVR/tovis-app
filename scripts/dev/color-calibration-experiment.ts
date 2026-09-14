// scripts/dev/color-calibration-experiment.ts
//
// Does correcting a photograph's white balance move the level the reader
// returns?
//
// Why this script exists. Every level experiment so far has changed what the
// model is TOLD — the scale definition (#1175), the underlying pigment
// (#1177), where to look (#1179) — or which views it is shown (the dual-image
// variant, measured and rejected). None of them has changed the PIXELS. The
// one error that survived all of it is fixture `i`: pale blonde read as a 5–6
// where Tori and the corpus independently say 8–9, on every run of every
// variant. An error that large, that consistent and that one-directional at
// the light end is the signature of a capture problem, not a knowledge
// problem — the reader cannot know what exposure and white balance a frame was
// taken at, and no amount of prompt text can tell it.
//
// This measures that directly. Given a photograph with a known-neutral patch
// in frame (a ColorChecker's grey patch, a grey card), it computes the
// per-channel gain that makes that patch actually neutral, applies it, and
// runs the SAME reader on the corrected and uncorrected frames. If the level
// moves toward truth, the bug is calibration and belongs in
// `normalizeImageForVision`. If it does not move, the bug is the model's
// notion of the scale and no colour correction will ever reach it.
//
// 🔴 Which reader this measures. `runConsultInspirationVision`
// (`inspiration-hair-color-v5`) — the single-image reader. That is the honest
// choice for a single test frame, and it is the reader whose native input
// shape this is. But the reader that sees a CLIENT's hair in production is the
// analysis engine, which receives all seven shots in one call, and
// `crown-level-experiment.ts` exists because a finding in the single-image
// reader did NOT transfer to it (the bench's 1.18 gap and LEVEL_1 floor both
// evaporated). So a result here is a finding about the inspiration read and a
// HYPOTHESIS about the analysis engine. Confirm it there before shipping
// anything.
//
// 🔴 Crop the reference out before reading. A ColorChecker in frame is a cue:
// the reader can see it is looking at a calibration shot, and the frame stops
// resembling the client photos this is supposed to generalize to. `--hair`
// takes the sample from the patch and then crops to the hair alone, so both
// variants are read from a frame that looks like an ordinary photograph.
// Without `--hair` the chart stays in frame and both variants are cued
// identically — still a valid paired comparison, but a weaker one.
//
// Live model calls cost money. Nothing here writes to a database: no meter
// sink is passed, exactly as the sanctioned eval runner does it.
//
// ⚠️ `--tsconfig scripts/dev/tsconfig.json` is REQUIRED, not optional. This
// script reaches `normalizeImageForVision`, which imports `server-only`, and
// under tsx that specifier resolves to nothing — the run dies before the first
// image is read. That tsconfig aliases it to the same no-op the vitest configs
// use. `crown-level-experiment.ts` needs no such thing because analysisEngine
// never imports it.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig scripts/dev/tsconfig.json \
//     scripts/dev/color-calibration-experiment.ts \
//     --image ~/shots/blonde-with-passport.jpg \
//     --neutral 2100,1400,180,180 \
//     --hair 400,300,1500,2000 \
//     --runs 3 --out /tmp/wb.json

import { readFile, writeFile } from 'node:fs/promises'

import sharp from 'sharp'

import {
  ConsultInspirationVisionError,
  runConsultInspirationVision,
  type ConsultInspirationAnalysisResult,
} from '@/lib/consult/inspirationVision'
import { consultHairLevelNumber } from '@/lib/consult/hairLevel'
import { normalizeImageForVision } from '@/lib/media/normalizeImage'

type Rect = { x: number; y: number; w: number; h: number }

type VariantName = 'raw' | 'white_balanced'

type Reading = {
  variant: VariantName
  run: number
  baseLevel: number | null
  lightestLevel: number | null
  baseConfidence: { min: number; max: number }
  tone: string
  credibilityFlags: string[]
  error?: string
}

// ── Arguments ───────────────────────────────────────────────────────────────

function parseRect(raw: string, flag: string): Rect {
  const parts = raw.split(',').map((part) => Number.parseInt(part.trim(), 10))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`${flag} must be four non-negative integers: x,y,w,h`)
  }
  const [x, y, w, h] = parts
  // The length check above already guarantees these, but it does not narrow
  // the element type — and this repo does not permit an assertion to say so.
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    throw new Error(`${flag} must be four non-negative integers: x,y,w,h`)
  }
  if (w < 1 || h < 1) throw new Error(`${flag} needs a positive width and height`)
  return { x, y, w, h }
}

function readArgs() {
  const argv = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag)
    return at >= 0 ? argv[at + 1] : undefined
  }
  const image = get('--image')
  const neutral = get('--neutral')
  if (!image) throw new Error('--image <path> is required')
  if (!neutral) {
    throw new Error(
      '--neutral x,y,w,h is required — the pixel rect of a known-neutral ' +
        'patch (a ColorChecker grey, a grey card) in the ORIGINAL image.',
    )
  }
  const runsRaw = get('--runs')
  const runs = runsRaw ? Number.parseInt(runsRaw, 10) : 3
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
    throw new Error('--runs must be between 1 and 20')
  }
  const hair = get('--hair')
  return {
    image,
    neutral: parseRect(neutral, '--neutral'),
    hair: hair ? parseRect(hair, '--hair') : null,
    runs,
    out: get('--out') ?? null,
  }
}

// ── The correction ──────────────────────────────────────────────────────────

/**
 * Per-channel gains that make the sampled patch neutral.
 *
 * The patch is neutral in the world, so whatever spread the camera recorded
 * across R, G and B is the illuminant's cast plus the camera's guess at it.
 * Scaling each channel to the patch's own mean removes exactly that spread and
 * nothing else.
 *
 * Green is the reference rather than the maximum channel: under the warm light
 * this is built to correct, red is the largest, so normalizing to the maximum
 * would scale red to 1 and push blue up hard — brightening the whole frame and
 * clipping the highlights, which on pale hair is the one thing that must not
 * happen. Anchoring on green holds luminance roughly still and splits the
 * correction between the two channels that actually carry the cast.
 */
function whiteBalanceGains(patch: { r: number; g: number; b: number }) {
  if (patch.r <= 0 || patch.g <= 0 || patch.b <= 0) {
    throw new Error(
      'The neutral patch has a zero channel mean — it is clipped to black, ' +
        'or the rect is off the image. Check --neutral against the original.',
    )
  }
  return { r: patch.g / patch.r, g: 1, b: patch.g / patch.b }
}

/**
 * 🔴 The crop is materialised before it is measured, and that is load-bearing.
 * `sharp.stats()` reports on the INPUT image and ignores everything queued in
 * the pipeline ahead of it, so `sharp(img).extract(rect).stats()` silently
 * returns whole-frame statistics — no error, no warning, just the wrong
 * numbers. Written that way this script computed its gains from a grey-world
 * average of the entire photograph while appearing to sample the patch, which
 * is a different (and much worse) experiment than the one it claims to run.
 * Verified on a synthetic frame with a known patch: the whole-image prediction
 * and the `.extract().stats()` result agreed to the decimal.
 */
async function samplePatch(image: Buffer, rect: Rect) {
  const cropped = await sharp(image)
    .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    .toBuffer()
  const stats = await sharp(cropped).stats()
  const [r, g, b] = stats.channels
  if (!r || !g || !b) throw new Error('The neutral patch has fewer than three channels.')
  // ANY clipped channel, not all three. Under the warm light this script
  // exists to correct, red saturates first and alone — so requiring all three
  // would stay silent in precisely the case that matters. A clipped channel
  // has lost the headroom the gain is computed from: its mean reads too low,
  // the gain comes out too small, and the correction silently under-shoots.
  const clipped: string[] = []
  if (r.max >= 255) clipped.push('red')
  if (g.max >= 255) clipped.push('green')
  if (b.max >= 255) clipped.push('blue')
  if (clipped.length > 0) {
    console.warn(
      `⚠️  The neutral patch is clipped in ${clipped.join(', ')} — those ` +
        'channels have no headroom left, so the gains computed from them ' +
        'under-correct. Re-shoot the patch a stop darker.',
    )
  }
  return { r: r.mean, g: g.mean, b: b.mean }
}

// ── Variants ────────────────────────────────────────────────────────────────

/**
 * Both variants go through `normalizeImageForVision` LAST, so each is the
 * exact byte sequence production would send. Correcting after normalization
 * would measure a path no consult ever takes.
 */
async function buildVariants(source: Buffer, options: { neutral: Rect; hair: Rect | null }) {
  // These rects are read off a photograph by eye, so getting one wrong is the
  // expected case, not the exceptional one. Checked here because sharp's own
  // failure for an out-of-bounds extract is `extract_area: bad extract area`,
  // which names neither the rect nor the flag that carried it.
  const { width, height } = await sharp(source).metadata()
  if (!width || !height) throw new Error('The image has no readable dimensions.')
  const checkBounds = (rect: Rect, flag: string) => {
    if (rect.x + rect.w > width || rect.y + rect.h > height) {
      throw new Error(
        `${flag} ${rect.x},${rect.y},${rect.w},${rect.h} runs past the edge of ` +
          `a ${width}x${height} image (needs x+w ≤ ${width}, y+h ≤ ${height}).`,
      )
    }
  }
  checkBounds(options.neutral, '--neutral')
  if (options.hair) checkBounds(options.hair, '--hair')

  const patch = await samplePatch(source, options.neutral)
  const gains = whiteBalanceGains(patch)

  // Both variants are re-encoded once, at the same quality, so the only
  // difference between them is the gain. An asymmetric encode would put a
  // generation of JPEG loss on one side of the comparison and not the other.
  // Encoding explicitly also makes the `image/jpeg` declared below true rather
  // than assumed, whatever format the source arrived in.
  const framed = (input: Buffer) =>
    (options.hair
      ? sharp(input).extract({
          left: options.hair.x,
          top: options.hair.y,
          width: options.hair.w,
          height: options.hair.h,
        })
      : sharp(input)
    ).jpeg({ quality: 95 })

  const rawBytes = await framed(source).toBuffer()
  const correctedBytes = await framed(source)
    // `linear(a, b)` is a * value + b per channel — a pure gain at b = 0.
    .linear([gains.r, gains.g, gains.b], [0, 0, 0])
    .toBuffer()

  const raw = await normalizeImageForVision(rawBytes, 'image/jpeg')
  const corrected = await normalizeImageForVision(correctedBytes, 'image/jpeg')
  return { patch, gains, variants: { raw, white_balanced: corrected } }
}

// ── Reading ─────────────────────────────────────────────────────────────────

function summarize(
  variant: VariantName,
  run: number,
  result: ConsultInspirationAnalysisResult,
): Reading {
  const { analysis } = result
  return {
    variant,
    run,
    baseLevel: consultHairLevelNumber(analysis.baseLevel.value),
    lightestLevel: consultHairLevelNumber(analysis.lightestLevel.value),
    baseConfidence: analysis.baseLevel.confidence,
    tone: analysis.tone.value,
    credibilityFlags: [...result.credibilityFlags],
  }
}

function mean(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
}

function format(value: number | null): string {
  return value === null ? '—' : value.toFixed(2)
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = readArgs()
  const source = await readFile(args.image)

  const { patch, gains, variants } = await buildVariants(source, {
    neutral: args.neutral,
    hair: args.hair,
  })

  console.log(`image:   ${args.image}`)
  console.log(
    `neutral patch measured: R=${patch.r.toFixed(1)} G=${patch.g.toFixed(1)} ` +
      `B=${patch.b.toFixed(1)}`,
  )
  console.log(
    `gains applied:          R=${gains.r.toFixed(4)} G=${gains.g.toFixed(4)} ` +
      `B=${gains.b.toFixed(4)}`,
  )
  // A patch that was already neutral yields gains of 1 and two identical
  // variants — the run would cost money to compare a frame with itself.
  const cast = Math.max(Math.abs(1 - gains.r), Math.abs(1 - gains.b))
  console.log(`cast magnitude:         ${(cast * 100).toFixed(1)}%`)
  if (cast < 0.01) {
    console.warn(
      '\n⚠️  The patch is already neutral to within 1%. There is nothing for ' +
        'white balance to correct here, so this frame cannot answer the ' +
        'question — shoot one under the light that is actually suspect.',
    )
  }
  console.log(`reader:  inspiration-hair-color-v5 (single-image)`)
  console.log(`framing: ${args.hair ? 'cropped to --hair' : 'full frame (reference in shot)'}`)
  console.log(`runs:    ${args.runs} per variant\n`)

  const readings: Reading[] = []
  for (const [name, image] of Object.entries(variants) as Array<
    [VariantName, (typeof variants)['raw']]
  >) {
    for (let run = 1; run <= args.runs; run++) {
      try {
        const result = await runConsultInspirationVision({
          image: {
            base64: image.bytes.toString('base64'),
            mediaType: image.contentType,
          },
          meter: null,
        })
        const reading = summarize(name, run, result)
        readings.push(reading)
        console.log(
          `  ${name.padEnd(14)} run ${run}  base=${reading.baseLevel ?? 'UNKNOWN'}  ` +
            `lightest=${reading.lightestLevel ?? 'UNKNOWN'}  tone=${reading.tone}`,
        )
      } catch (error) {
        // A refusal is data, not a crash: record it and keep the other runs.
        //
        // The `kind` matters more than the message here. Every failure mode of
        // this reader carries the SAME sentence ("Inspiration analysis is
        // unavailable."), so the message alone cannot tell "the provider is
        // down" from "there is no readable hair in this frame" — and those two
        // mean opposite things for a run. `unreadable` on both variants means
        // the fixture is wrong; `unavailable` means the call never landed.
        const kind =
          error instanceof ConsultInspirationVisionError ? error.kind : 'unknown'
        const message = `${kind}: ${
          error instanceof Error ? error.message : String(error)
        }`
        readings.push({
          variant: name,
          run,
          baseLevel: null,
          lightestLevel: null,
          baseConfidence: { min: 0, max: 0 },
          tone: 'UNKNOWN',
          credibilityFlags: [],
          error: message,
        })
        console.log(`  ${name.padEnd(14)} run ${run}  ERROR ${message}`)
      }
    }
  }

  const byVariant = (name: VariantName) => readings.filter((r) => r.variant === name)
  const rawBase = mean(byVariant('raw').map((r) => r.baseLevel))
  const wbBase = mean(byVariant('white_balanced').map((r) => r.baseLevel))
  const rawLightest = mean(byVariant('raw').map((r) => r.lightestLevel))
  const wbLightest = mean(byVariant('white_balanced').map((r) => r.lightestLevel))

  console.log(`\n${'variant'.padEnd(16)}${'baseLevel'.padEnd(12)}lightestLevel`)
  console.log(`${'raw'.padEnd(16)}${format(rawBase).padEnd(12)}${format(rawLightest)}`)
  console.log(
    `${'white_balanced'.padEnd(16)}${format(wbBase).padEnd(12)}${format(wbLightest)}`,
  )
  // Both fields, always. Reporting only `baseLevel` would have hidden the one
  // that moved on this script's own first real run: base held at 6 across all
  // four calls while lightestLevel went 8 → 9 under correction, reproducibly.
  const shifts: Array<[string, number | null, number | null]> = [
    ['baseLevel', rawBase, wbBase],
    ['lightestLevel', rawLightest, wbLightest],
  ]
  console.log('')
  for (const [field, before, after] of shifts) {
    if (before === null || after === null) {
      console.log(`shift: ${field} not readable in both variants — no comparison`)
      continue
    }
    const shift = after - before
    console.log(
      `shift: ${shift >= 0 ? '+' : ''}${shift.toFixed(2)} levels on ${field} ` +
        `(positive = white balance read the hair LIGHTER)`,
    )
  }
  console.log(
    '\nA shift toward the true level is evidence for a correction step in ' +
      'normalizeImageForVision. No shift means the level error is not in the ' +
      'pixels, and the next experiment belongs somewhere else. With runs this ' +
      'few, a one-level move is a reason to run more — not a result.',
  )

  if (args.out) {
    await writeFile(
      args.out,
      `${JSON.stringify(
        {
          image: args.image,
          reader: 'inspiration-hair-color-v5',
          neutral: args.neutral,
          hair: args.hair,
          patch,
          gains,
          runs: args.runs,
          readings,
          summary: { rawBase, wbBase, rawLightest, wbLightest },
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    )
    console.log(`\nwrote ${args.out}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
