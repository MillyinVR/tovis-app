/** Explicit, bounded smoke test: synthetic repo fixtures only, two model calls. */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runConsultHairMap } from '../../lib/consult/hairMapRuntime'
import { sanitizeConsultHairMap, type ConsultHairMapScope } from '../../lib/consult/hairMap'
import { compareConsultHairMaps } from '../../lib/consult/hairComparison'

async function main() {
  if (process.env.TOVIS_LIVE_HAIR_MAP !== '1') throw new Error('Set TOVIS_LIVE_HAIR_MAP=1 to authorize two synthetic model calls.')
  const output = process.argv[2]
  if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute output JSON path.')
  const fixtures = path.resolve('eval/consult/hair-color/v1/fixtures')
  const cases = [
    { file: 'synthetic-iii-hair_back.jpg', scope: { role: 'CURRENT', views: ['hair_back'] } },
    { file: 'synthetic-i-hair_back.jpg', scope: { role: 'REFERENCE', views: ['inspiration'] } },
  ] as const satisfies ReadonlyArray<{ file: string; scope: ConsultHairMapScope }>
  const startedAt = Date.now()
  const results = await Promise.allSettled(cases.map(async item => {
    const bytes = await readFile(path.join(fixtures, item.file))
    const result = await runConsultHairMap({ scope: item.scope, images: [{ view: item.scope.views[0], image: { mediaType: 'image/jpeg', base64: bytes.toString('base64') } }] })
    return { model: result.model, map: sanitizeConsultHairMap(result.raw, item.scope) }
  }))
  const [current, reference] = results
  if (!current || !reference || current.status === 'rejected' || reference.status === 'rejected') {
    throw new Error(`Synthetic map smoke failed: current=${current?.status}, reference=${reference?.status}. Inspect content-free provider checks.`)
  }
  const comparison = compareConsultHairMaps(current.value.map, reference.value.map)
  await writeFile(output, JSON.stringify({ fixtures: cases.map(item => item.file), model: current.value.model, elapsedMs: Date.now() - startedAt, comparison }, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ output, model: current.value.model, elapsedMs: Date.now() - startedAt,
    supportedComparisons: comparison.differences.filter(item => item.status !== 'NEEDS_CONFIRMATION').length,
    note: 'Synthetic smoke test only; not an accuracy or calibration result.' }))
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Synthetic comparison smoke failed.')
  process.exitCode = 1
})
