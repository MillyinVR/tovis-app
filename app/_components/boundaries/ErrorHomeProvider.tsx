// app/_components/boundaries/ErrorHomeProvider.tsx
'use client'

import { createContext, useContext, type ReactNode } from 'react'

import { GUEST_HOME, type ErrorHome } from './errorHome'

// Publishes the server-resolved "where is this viewer's home" answer to client
// boundaries.
//
// Next's error.tsx is ALWAYS a client component and only ever receives
// { error, reset } from the framework — it cannot await resolveErrorHome()
// itself, and it cannot read the session either: `tovis_token` is httpOnly
// (see lib/currentUser.ts), so there is nothing for browser JS to read. The
// role has to come down from the server.
//
// It arrives the same way the tenant brand already does: the root layout
// resolves it on the server and hands it to a client provider. A segment error
// boundary renders INSIDE the root layout, so this context is above it — the
// exact property ErrorState already relies on for useBrand().
//
// app/global-error.tsx is the one boundary this cannot reach: it REPLACES the
// root layout, so no provider exists above it. It has no home link, so there is
// nothing there to make role-aware.

const ErrorHomeContext = createContext<ErrorHome>(GUEST_HOME)

export function ErrorHomeProvider({
  value,
  children,
}: {
  value: ErrorHome
  children: ReactNode
}) {
  return (
    <ErrorHomeContext.Provider value={value}>
      {children}
    </ErrorHomeContext.Provider>
  )
}

/**
 * The viewer's home for a client-side boundary. Defaults to the guest home when
 * no provider is above it — an error boundary must never throw on its way to
 * rendering an error, so a missing provider degrades to the public home rather
 * than replacing the error page with a second one.
 */
export function useErrorHome(): ErrorHome {
  return useContext(ErrorHomeContext)
}
