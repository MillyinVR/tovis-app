// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Bring Sentry up first so any startup failure can be reported, then enforce
    // the production env contract (fail-closed — see startupEnvValidation.ts).
    await import('./sentry.server.config')

    const { validateProductionStartupEnv } = await import(
      '@/lib/observability/startupEnvValidation'
    )
    validateProductionStartupEnv()
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Next.js reads `onRequestError` from THIS file and nowhere else. Without it,
// no unhandled server error reaches Sentry at all: the SDK's other route into
// server errors is the build-time wrapping loader, which `withSentryConfig`
// installs only on the webpack path, and this app builds with Turbopack.
// See lib/observability/requestErrors.ts for the full derivation.
export { captureRouteRequestError as onRequestError } from '@/lib/observability/requestErrors'
