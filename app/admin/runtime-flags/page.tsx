// app/admin/runtime-flags/page.tsx
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getAdminUiPerms } from '@/lib/adminUiPermissions'
import {
  getRuntimeFlags,
  setRuntimeFlag,
  RUNTIME_FLAG_NAMES,
  type RuntimeFlagName,
} from '@/lib/runtimeFlags'

export const dynamic = 'force-dynamic'

type FlagMeta = {
  name: RuntimeFlagName
  title: string
  description: string
}

const FLAG_META: Record<RuntimeFlagName, FlagMeta> = {
  signup_disabled: {
    name: 'signup_disabled',
    title: 'Signup disabled',
    description:
      'Stops new account creation without a deploy. Existing users can still log in.',
  },
  sms_disabled: {
    name: 'sms_disabled',
    title: 'SMS disabled',
    description:
      'Stops verification SMS sends without a deploy. Use this if the SMS provider is misbehaving or under attack.',
  },
}

function isRuntimeFlagName(value: string): value is RuntimeFlagName {
  return (RUNTIME_FLAG_NAMES as readonly string[]).includes(value)
}

async function requireRuntimeFlagAdmin() {
  const info = await getAdminUiPerms()

  if (!info) {
    redirect('/login?from=/admin/runtime-flags')
  }

  if (!info.perms.canManagePermissions) {
    redirect('/forbidden')
  }

  return info
}

async function updateRuntimeFlag(formData: FormData) {
  'use server'

  await requireRuntimeFlagAdmin()

  const rawName = String(formData.get('name') ?? '').trim()
  const rawEnabled = String(formData.get('enabled') ?? '').trim().toLowerCase()

  if (!isRuntimeFlagName(rawName)) {
    throw new Error('Invalid runtime flag name.')
  }

  const enabled =
    rawEnabled === '1' || rawEnabled === 'true' || rawEnabled === 'on'

  await setRuntimeFlag(rawName, enabled)
  revalidatePath('/admin/runtime-flags')
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black',
        enabled
          ? 'border-red-400/30 bg-red-500/10 text-red-200'
          : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
      ].join(' ')}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  )
}

export default async function AdminRuntimeFlagsPage() {
  const info = await requireRuntimeFlagAdmin()
  const flags = await getRuntimeFlags()

  const items = RUNTIME_FLAG_NAMES.map((name) => ({
    meta: FLAG_META[name],
    enabled: flags[name],
  }))

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5 grid gap-2">
        <h1 className="text-[22px] font-black">Runtime flags</h1>
        <p className="text-[13px] text-textSecondary">
          Toggle Step 3 abuse-control kill switches without a deploy.
        </p>
        <div className="text-[12px] text-textSecondary">
          Signed in as {info.email ?? 'admin user'}
        </div>
      </div>

      {!flags.backendAvailable ? (
        <div className="mb-4 rounded-card border border-amber-400/20 bg-amber-500/10 p-4 text-[13px] text-amber-100">
          Redis is unavailable, so runtime flags are currently read as off and
          cannot be changed from this page.
        </div>
      ) : null}

      <div className="grid gap-4">
        {items.map(({ meta, enabled }) => {
          const nextEnabled = !enabled

          return (
            <section
              key={meta.name}
              className="rounded-card border border-white/10 bg-bgSecondary p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-black">{meta.title}</h2>
                    <StatusPill enabled={enabled} />
                  </div>

                  <p className="mt-2 text-[13px] text-textSecondary">
                    {meta.description}
                  </p>

                  <div className="mt-2 text-[12px] text-textSecondary">
                    Flag key:{' '}
                    <span className="font-black text-textPrimary/90">
                      {meta.name}
                    </span>
                  </div>
                </div>

                <form action={updateRuntimeFlag} className="shrink-0">
                  <input type="hidden" name="name" value={meta.name} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={nextEnabled ? 'true' : 'false'}
                  />

                  <button
                    type="submit"
                    disabled={!flags.backendAvailable}
                    className={[
                      'inline-flex min-w-[140px] items-center justify-center rounded-full border px-4 py-2 text-[12px] font-black transition active:scale-[0.98]',
                      flags.backendAvailable
                        ? enabled
                          ? 'border-red-400/25 bg-red-500/10 text-red-100 hover:border-red-400/35 hover:bg-red-500/15'
                          : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:border-emerald-400/35 hover:bg-emerald-500/15'
                        : 'cursor-not-allowed border-white/10 bg-bgPrimary/40 text-textSecondary opacity-60',
                    ].join(' ')}
                  >
                    {enabled ? 'Disable flag' : 'Enable flag'}
                  </button>
                </form>
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}