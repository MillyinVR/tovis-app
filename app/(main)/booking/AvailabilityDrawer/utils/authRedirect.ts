// app/(main)/booking/AvailabilityDrawer/utils/authRedirect.ts
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { loginHrefFromHere } from '@/lib/clientNavigation'

export function redirectToLogin(router: AppRouterInstance, reason: string) {
  router.push(loginHrefFromHere('/looks', reason || 'auth'))
}
