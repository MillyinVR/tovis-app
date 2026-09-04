// tests/integration/_support/consultLookFakes.ts
//
// The fakes Book the Look's integration suites stand in for: private capture
// storage, the capture quality vision call, and the analysis engine.
//
// ⚠️ A LEAF MODULE ON PURPOSE. It imports nothing from `@/` — not a route, not
// a lib. Vitest hoists `vi.mock` factories above every import in a test file,
// so a factory that reaches for a helper must `await import()` it, and if that
// helper pulled in the very module being mocked the graph would cycle. Keeping
// this module free of app imports is what lets both suites write:
//
//   vi.mock('@/lib/consult/captureStorage', async () => {
//     const m = await import('./_support/consultLookFakes')
//     return m.buildFakeCaptureStorageModule()
//   })
//
// The scenario knobs below are mutable module state, reset by
// `resetConsultLookFakes()` in each suite's `beforeEach`. That is how B4 flips
// the analysis into its safety-routed shape without a second analysis mock.

export type FakeStorageObject = {
  contentType: string
  sizeBytes: number
  checksumSha256: string | null
}

/** The private objects a suite's uploads have "landed" in. */
/**
 * P4 made the analysis resolve the ANCHORING LOOK's media URL — the reference
 * has to be fetched before it can be read — so every suite that drives a
 * look-anchored consult to COMPLETED now needs a Supabase URL to build a
 * public object URL from. The integration workflow sets none (unlike e2e.yml
 * and perf-availability.yml), so without this the read fails
 * INSPIRATION_LOOK_UNAVAILABLE and the consult 404s three steps later, which
 * is exactly how it showed up in CI while passing on a laptop that happens to
 * have real Supabase env.
 *
 * `||=` so a developer's real value still wins. Same self-contained default
 * `consult-look-anchor.test.ts` already sets for itself; this is that line,
 * shared by the suites that were missing it. It builds a URL string and makes
 * no network call — a public bucket needs no credential.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://storage.test'

export const fakeStorageObjects = new Map<string, FakeStorageObject>()

const state = {
  pathSequence: 0,
  runId: Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0'),
  /**
   * Safety flags the faked analysis reports. Empty is the ordinary path; B4
   * sets one to prove that an estimate for a safety-routed analysis is NOT a
   * proposal, however well the pro's menu prices.
   */
  safetyFlags: [] as Array<{
    code: string
    summary: string
    discussWithProfessional: true
  }>,
}

export function resetConsultLookFakes(): void {
  fakeStorageObjects.clear()
  state.safetyFlags = []
}

/** Route the faked analysis to safety prerequisites on its next run. */
export function setFakeAnalysisSafetyFlag(code: string): void {
  state.safetyFlags = [
    {
      code,
      summary: 'A prior reaction was reported; test for sensitivity first.',
      discussWithProfessional: true,
    },
  ]
}

export function buildFakeCaptureStorageModule() {
  class FakeStorageError extends Error {
    constructor(readonly kind: 'unavailable' | 'missing' | 'invalid') {
      super('Private capture storage is unavailable.')
      this.name = 'ConsultCaptureStorageError'
    }
  }

  return {
    CONSULT_CAPTURE_BUCKET: 'media-private',
    CONSULT_CAPTURE_MAX_BYTES: 5_000_000,
    ConsultCaptureStorageError: FakeStorageError,
    consultCaptureObjectPath() {
      state.pathSequence += 1
      const tail = state.pathSequence.toString(16).padStart(12, '0')
      return `consult-raw/v1/${state.runId}-0000-4000-8000-${tail}.jpg`
    },
    consultCaptureStorage: {
      assertReady: async () => undefined,
      async createSignedUpload() {
        return { token: 'signed', signedUrl: 'https://storage.test/signed' }
      },
      async createSignedRead(_path: string, expiresInSeconds: number) {
        return `https://storage.test/read/${expiresInSeconds}`
      },
      async inspectObject(args: { path: string }) {
        const object = fakeStorageObjects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        return object
      },
      async readObject(args: { path: string }) {
        const object = fakeStorageObjects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        return { base64: 'bm90LXJhdy1pbi1kYg==', mediaType: object.contentType }
      },
      async copyObject(args: { fromPath: string; toPath: string }) {
        const object = fakeStorageObjects.get(args.fromPath)
        if (!object) throw new FakeStorageError('missing')
        fakeStorageObjects.set(args.toPath, object)
      },
      async purgeObject(path: string) {
        fakeStorageObjects.delete(path)
      },
    },
  }
}

export async function fakeCheckConsultCapture() {
  return {
    accepted: true,
    reasonCode: 'PASS',
    warningCode: null,
    retakeTip: null,
    model: 'fake-quality-model',
  }
}

const observed = (value: string, evidence: string[] = ['hair_back']) => ({
  value,
  confidence:
    value === 'UNKNOWN' ? { min: 0, max: 0.25 } : { min: 0.4, max: 0.7 },
  evidence,
})

/**
 * The faked analysis payload.
 *
 * The two recommendations are chosen so the analysis resolves ONE of them to
 * the look's own linked service (the fixture's "… Balayage") and the other to
 * a second service on the pro's menu ("… Toner Gloss"). That is exactly the
 * shape B3 has to translate — a floor line that also carries an analysis
 * reason, plus one line beyond it — and exactly the shape B4 has to size a
 * slot from. Schema v3: the provider names the services from the menu it was
 * handed, so the fake reads them off its input rather than guessing.
 */
/** `service` name → the stored `{serviceIntent, serviceName}` the engine emits. */
function recommended(service: string) {
  return service === 'A consultation with the professional'
    ? { serviceIntent: 'CONSULTATION' as const, serviceName: null }
    : { serviceIntent: 'SERVICE' as const, serviceName: service }
}

export async function fakeRunConsultAnalysis(input: {
  service: { menuServiceNames: readonly string[] }
}) {
  const menu = input.service.menuServiceNames
  const named = (pattern: RegExp) =>
    menu.find((name) => pattern.test(name)) ?? 'A consultation with the professional'
  return {
    model: 'fake-analysis-model',
    analysis: {
      profile: {
        skinUndertone: observed('NEUTRAL', ['face_front']),
        contrastLevel: observed('MEDIUM', ['face_front']),
        colorSeason: observed('UNKNOWN', []),
        faceProportion: observed('BALANCED', ['face_front']),
        jawline: observed('SOFTLY_ROUNDED', ['face_side']),
        foreheadProportion: observed('BALANCED', ['face_side']),
        featureBalance: observed('SOFT', ['face_front']),
        eyeShape: observed('HOODED', ['eyes_closeup']),
        eyeSpacing: observed('BALANCED', ['eyes_closeup']),
        browDensity: observed('FULL', ['eyes_closeup']),
        browShape: observed('SOFT_ARCH', ['eyes_closeup']),
      },
      styleDirections: [
        'HAIR_COLOR_HARMONY',
        'CUT_AND_SHAPE',
        'BANGS',
        'BROWS',
        'LASHES',
        'MAKEUP',
        'COLOR_PALETTE',
      ].map((domain) => ({
        domain,
        title: 'A soft, harmonizing direction',
        direction: 'Discuss a soft, blended direction for this domain together.',
        whyItFlatters:
          'Low observed contrast and soft feature balance favor blended choices.',
        confidence: { min: 0.4, max: 0.7 },
        evidence: ['face_front'],
        discussWithProfessional: true,
      })),
      core: {
        baseLevel: {
          value: 'LEVEL_4',
          confidence: { min: 0.5, max: 0.75 },
          evidence: ['hair_back', 'hair_crown'],
        },
        lightestLevel: {
          value: 'LEVEL_5',
          confidence: { min: 0.5, max: 0.75 },
          evidence: ['hair_back', 'hair_crown'],
        },
        currentTone: observed('MIXED'),
        visibleCondition: observed('NO_VISIBLE_CONCERN'),
        density: observed('UNKNOWN', []),
        texture: observed('WAVY'),
      },
      serviceLens: {
        goal: 'A noticeable red direction grounded in the intake goal.',
        history: 'Prior lightening and box-dye timing affect the range.',
        constraints: 'Allergy history and other constraints are unknown.',
        maintenance: 'Maintenance tolerance was not collected and is unknown.',
        appointmentContext:
          'Appointment context uses the intake timing and budget.',
        achievability: 'REQUIRES_PRO_ASSESSMENT',
        achievabilityReason:
          'The professional should assess condition and history.',
        discussWithProfessional: true,
      },
      safetyFlags: state.safetyFlags.map((flag) => ({ ...flag })),
      // 🔴 The STORED shape (serviceIntent + serviceName), because that is
      // what `runConsultAnalysis` returns — `sanitizeRecommendation` converts
      // the provider's `service` enum on the way through. This fake used to
      // return the un-converted provider shape, which is how a validator that
      // could never accept a real analysis passed every test it had.
      recommendations: [
        {
          ...recommended(named(/balayage/i)),
          title: 'Hand-painted dimension',
          rationale: 'A hand-painted approach suits the blended direction.',
          achievability: 'The professional decides what is achievable today.',
          discussWithProfessional: true,
        },
        {
          ...recommended(named(/toner gloss/i)),
          title: 'A gloss to hold the tone',
          rationale: 'The mid-lengths would otherwise read brassy in weeks.',
          achievability: 'The professional confirms the toner in person.',
          discussWithProfessional: true,
        },
      ],
    },
  }
}

/**
 * P4 — the inspiration read, faked for every suite that drives a consult to
 * COMPLETED. Two seams, because the read is two steps: fetching the reference
 * bytes through the signed-read path, and the paid vision call over them.
 *
 * `fetchConsultInspirationImage` MUST be faked in these suites: the fake
 * storage mints `https://storage.test/...`, and the real fetch correctly
 * refuses that host (it is not this project's Supabase origin), which would
 * otherwise surface as a 422 on every analysis.
 */
export async function fakeFetchConsultInspirationImage(): Promise<{
  base64: string
  mediaType: 'image/jpeg'
}> {
  return { base64: 'aW5zcGlyYXRpb24=', mediaType: 'image/jpeg' }
}

export async function fakeRunConsultInspirationVision(): Promise<{
  model: string
  analysis: Record<string, unknown>
}> {
  const known = (value: string) => ({
    value,
    confidence: { min: 0.4, max: 0.65 },
    evidence: ['inspiration'] as const,
    region: { x: 0.15, y: 0.2, w: 0.6, h: 0.5 },
  })
  return {
    model: 'fake-inspiration-model',
    analysis: {
      baseLevel: known('LEVEL_5'),
      lightestLevel: known('LEVEL_8'),
      tone: known('COOL'),
      technique: known('BALAYAGE'),
      placement: known('MIDS_TO_ENDS'),
      rootBlend: known('SHADOW_ROOT'),
      finish: known('HIGH_SHINE'),
      dimension: known('MEDIUM'),
    },
  }
}
