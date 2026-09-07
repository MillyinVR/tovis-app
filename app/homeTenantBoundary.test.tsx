import { expect, it, vi } from 'vitest'
vi.mock('@/lib/tenant/layoutContext', () => ({
  resolveTenantContextForLayout: async () => ({
    isRoot: false,
    tenantId: 'partner-test',
    slug: 'unregistered-partner',
  }),
}))
import Home from './page'

it('does not inherit root campaign programs on an unregistered partner homepage', async () => {
  const page = JSON.stringify(await Home(), (key, value: unknown) =>
    key === 'type' || key === '_owner' ? undefined : value,
  )
  expect(page).not.toContain('Platinum')
  expect(page).not.toContain('first year of TOVIS membership free')
})
