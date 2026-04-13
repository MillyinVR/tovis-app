import Link from 'next/link'
import { redirect } from 'next/navigation'

type SearchParamsInput = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: SearchParamsInput | Promise<SearchParamsInput | undefined>
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return (value[0] ?? '').trim() || null
  return null
}

function sanitizeRole(value: string | null): 'CLIENT' | 'PRO' | null {
  const normalized = (value ?? '').trim().toUpperCase()
  if (normalized === 'CLIENT') return 'CLIENT'
  if (normalized === 'PRO') return 'PRO'
  return null
}

function appendIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value) params.set(key, value)
}

function buildQueryString(args: {
  searchParams: SearchParamsInput
  roleOverride?: 'CLIENT' | 'PRO'
  includeEmailForLogin?: boolean
}): string {
  const params = new URLSearchParams()

  appendIfPresent(params, 'ti', firstParam(args.searchParams.ti))
  appendIfPresent(params, 'from', firstParam(args.searchParams.from))
  appendIfPresent(params, 'next', firstParam(args.searchParams.next))
  appendIfPresent(params, 'intent', firstParam(args.searchParams.intent))
  appendIfPresent(
    params,
    'inviteToken',
    firstParam(args.searchParams.inviteToken),
  )
  appendIfPresent(params, 'name', firstParam(args.searchParams.name))
  appendIfPresent(params, 'phone', firstParam(args.searchParams.phone))

  if (args.includeEmailForLogin) {
    appendIfPresent(params, 'email', firstParam(args.searchParams.email))
  } else {
    appendIfPresent(params, 'email', firstParam(args.searchParams.email))
  }

  if (args.roleOverride) {
    params.set('role', args.roleOverride)
  } else {
    appendIfPresent(params, 'role', firstParam(args.searchParams.role))
  }

  const query = params.toString()
  return query ? `?${query}` : ''
}

export default async function SignupChooserPage(props: PageProps) {
  const resolvedSearchParams =
    (await Promise.resolve(props.searchParams).catch(() => undefined)) ?? {}

  const role = sanitizeRole(firstParam(resolvedSearchParams.role))
  const intent = firstParam(resolvedSearchParams.intent)

  const clientQs = buildQueryString({
    searchParams: resolvedSearchParams,
    roleOverride: 'CLIENT',
  })

  const proQs = buildQueryString({
    searchParams: resolvedSearchParams,
    roleOverride: 'PRO',
  })

  const loginQs = buildQueryString({
    searchParams: resolvedSearchParams,
    includeEmailForLogin: true,
  })

  if (intent === 'CLAIM_INVITE' && role === 'CLIENT') {
    redirect(`/signup/client${clientQs}`)
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5 tovis-glass-soft">
        <div className="text-lg font-black text-textPrimary">
          Create your account
        </div>

        <div className="text-sm text-textSecondary">
          {intent === 'CLAIM_INVITE'
            ? 'Create the right account first so we can attach your claimed history correctly.'
            : 'Pick what you’re here to do.'}
        </div>

        <div className="grid gap-2 pt-2">
          <Link
            href={`/signup/pro${proQs}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-accentPrimary/35 bg-accentPrimary/26 px-4 py-2.5 text-sm font-black text-textPrimary transition hover:bg-accentPrimary/30 hover:border-accentPrimary/45 focus:outline-none focus:ring-2 focus:ring-accentPrimary/20"
          >
            I’m a Pro — Offer services
          </Link>

          <Link
            href={`/signup/client${clientQs}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2.5 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/20 hover:bg-bgPrimary/30 focus:outline-none focus:ring-2 focus:ring-accentPrimary/15"
          >
            I’m a Client — Book services
          </Link>

          <div className="pt-2 text-center text-xs text-textSecondary/70">
            Already have an account?{' '}
            <Link
              href={`/login${loginQs}`}
              className="font-black text-textPrimary hover:text-accentPrimary"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}