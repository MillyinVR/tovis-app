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