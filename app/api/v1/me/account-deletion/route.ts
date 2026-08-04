// app/api/v1/me/account-deletion/route.ts
//
// The self-serve account deletion path required by App Store guideline
// 5.1.1(v). Role-agnostic on purpose: the same three verbs serve the client
// app, the pro app and the web settings pages, so there is one deletion
// contract rather than one per surface.
//
//   GET    — obligations + any open request, so the UI can explain before it asks
//   POST   — open the deletion window (requires typed email re-confirmation)
//   DELETE — cancel while still inside the window
//
// The destructive work itself happens in the cron sweep, never in the request
// handler: see lib/privacy/accountDeletion.ts.

import { jsonFail, jsonOk } from "@/app/api/_utils/responses";
import { requireUser } from "@/app/api/_utils/auth/requireUser";
import {
  cancelAccountDeletion,
  loadAccountDeletionStatus,
  requestAccountDeletion,
} from "@/lib/privacy/accountDeletion";
import { prisma } from "@/lib/prisma";
import { safeError } from "@/lib/security/logging";

export const dynamic = "force-dynamic";

/**
 * Deletion is reachable from a VERIFICATION-kind session, unlike almost every
 * other authenticated route.
 *
 * `requireUser()` defaults to refusing a session that is not fully verified.
 * Applied here that would mean a person who signed up, never finished phone or
 * email verification, and now wants their data gone **cannot delete their own
 * account** — the exact person most likely to want to, and a direct failure of
 * App Store guideline 5.1.1(v). Same defect shape as the pro onboarding gate
 * that hid /pro/account/delete.
 *
 * Safe because the session is still a real authenticated session for that user,
 * every action is scoped to `auth.user.id` (never an id from the request), and
 * the destructive verb additionally requires the account's own email typed back.
 */
const DELETION_AUTH = { allowVerificationSession: true } as const;

export async function GET() {
  try {
    const auth = await requireUser(DELETION_AUTH);
    if (!auth.ok) return auth.res;

    const status = await loadAccountDeletionStatus({
      db: prisma,
      userId: auth.user.id,
    });

    return jsonOk({ accountDeletion: status }, 200);
  } catch (error: unknown) {
    console.error("GET /api/v1/me/account-deletion error", {
      error: safeError(error),
    });
    return jsonFail(500, "Failed to load account deletion status.");
  }
}

type RequestBody = {
  confirmEmail?: unknown;
  reason?: unknown;
};

async function readBody(request: Request): Promise<RequestBody> {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed;
  } catch {
    return {};
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(DELETION_AUTH);
    if (!auth.ok) return auth.res;

    const body = await readBody(request);
    const confirmEmail = readString(body.confirmEmail);

    // Re-confirmation is the user typing their own email address. The
    // comparison itself lives in lib/privacy/accountDeletion.ts so the account
    // email is never read here — see that helper for why it is not a password.
    if (!confirmEmail) {
      return jsonFail(400, "Type your email address to confirm.", {
        code: "CONFIRMATION_REQUIRED",
      });
    }

    const result = await requestAccountDeletion({
      db: prisma,
      userId: auth.user.id,
      confirmEmail,
      reason: readString(body.reason),
    });

    if (!result.ok && result.code === "CONFIRMATION_MISMATCH") {
      return jsonFail(400, "That email address does not match your account.", {
        code: "CONFIRMATION_MISMATCH",
      });
    }

    if (!result.ok && result.code === "BLOCKED") {
      return jsonFail(409, "Your account still has things to settle first.", {
        code: "BLOCKED",
        blockers: result.blockers,
      });
    }

    if (!result.ok) {
      // Idempotent in spirit: a second tap reports the window that is already
      // open rather than failing at the user.
      return jsonOk({ request: result.request, alreadyPending: true }, 200);
    }

    return jsonOk({ request: result.request, alreadyPending: false }, 201);
  } catch (error: unknown) {
    console.error("POST /api/v1/me/account-deletion error", {
      error: safeError(error),
    });
    return jsonFail(500, "Failed to request account deletion.");
  }
}

export async function DELETE() {
  try {
    const auth = await requireUser(DELETION_AUTH);
    if (!auth.ok) return auth.res;

    const result = await cancelAccountDeletion({
      db: prisma,
      userId: auth.user.id,
    });

    if (!result.ok) {
      return jsonFail(404, "You do not have a scheduled account deletion.", {
        code: "NOT_PENDING",
      });
    }

    return jsonOk({ request: result.request }, 200);
  } catch (error: unknown) {
    console.error("DELETE /api/v1/me/account-deletion error", {
      error: safeError(error),
    });
    return jsonFail(500, "Failed to cancel account deletion.");
  }
}
