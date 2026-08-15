// GET /api/v1/pro/portfolio — the pro's ONE media library, for native.
//
// Parity twin of the web `/pro/portfolio` RSC page: both call the same
// `buildProPortfolioModel`, so the phone and the browser can never disagree
// about what is public, what is held, or which client a photo is waiting on.
// That mattered here more than usual — before this route iOS rendered an
// entirely different screen ("My media", two independent visibility toggles)
// against `/api/v1/pro/media`, which is the model this library replaced.
//
// `filter` / `q` mirror the page's search params exactly, so a native filter
// chip and a web filter chip resolve through the same code.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import {
  buildProPortfolioModel,
  type ProPortfolioSearchParams,
} from '@/app/pro/portfolio/_data/loadProPortfolioPage'
import type { ProPortfolioPageModel } from '@/app/pro/portfolio/_data/proPortfolioTypes'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OPERATION = 'GET /api/v1/pro/portfolio'

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const url = new URL(req.url)
    const searchParams: ProPortfolioSearchParams = {
      filter: url.searchParams.get('filter') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
    }

    const portfolio: ProPortfolioPageModel | null = await buildProPortfolioModel(
      {
        professionalId: auth.professionalId,
        searchParams,
      },
    )

    // The web page redirects here; a native client gets an honest 404 instead of
    // a 307 to a login screen it cannot render.
    if (!portfolio) return jsonFail(404, 'Professional profile not found.')

    return jsonOk({ portfolio }, 200)
  } catch (error: unknown) {
    console.error(`${OPERATION} error`, { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}
