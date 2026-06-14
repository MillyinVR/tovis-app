// app/api/_utils/routeContext.ts
//
// Single source of truth for Next.js App Router route-handler context typing.
// Across the codebase `params` is reached both synchronously and as a Promise
// (the App Router contract changed to async params), so the canonical shape
// accepts either and `resolveRouteParams` awaits it uniformly.
//
// Import these from this specific path (NOT the `@/app/api/_utils` barrel):
// route tests partial-mock the barrel, which would make the runtime helper
// `undefined` in those tests.

export type RouteParams = Record<string, string>

export type RouteContext<P extends RouteParams = { id: string }> = {
  params: P | Promise<P>
}

export async function resolveRouteParams<P extends RouteParams>(
  ctx: RouteContext<P>,
): Promise<P> {
  return await Promise.resolve(ctx.params)
}
