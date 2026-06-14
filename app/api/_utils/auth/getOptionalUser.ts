// app/api/_utils/auth/getOptionalUser.ts
import { type CurrentUser, getCurrentUser } from '@/lib/currentUser'

/**
 * Resolve the current user when present, or null. Never throws.
 *
 * For routes that personalize when a user is logged in but also serve anonymous
 * requests (e.g. the Looks feed). For routes that REQUIRE a logged-in user,
 * use requireUser/requireClient/requirePro instead — those also enforce the
 * verification gating that this helper deliberately does not.
 */
export async function getOptionalUser(): Promise<CurrentUser | null> {
  return getCurrentUser().catch(() => null)
}
