// app/_components/ClientProfileLink.tsx
//
// Single source of truth for making a client's IDENTITY — their name, their
// avatar, or both — tap through on a PRO-facing surface. The mirror of
// ProProfileLink (#829), which did the same for a pro's identity on every
// client-facing surface. Both render through the shared ProfileIdentityLink.
//
// The destination is NOT decided here. It is resolved server-side by
// `resolveClientProfileHref` / `clientIdentityHref` (lib/profiles/profileHrefs),
// which is the one rule:
//
//   1. a viewing pro who may open this client  → /pro/clients/[id] (the chart)
//   2. otherwise, the client opted into a public identity → /u/[handle]
//   3. otherwise                                → null → inert text
//
// Resolving server-side is deliberate: step 1 needs the pro's visible-client
// set, and building the chart href in the browser would put a ClientProfile id
// in the DOM for a viewer who is not allowed to open it. So this component takes
// an already-resolved `href` and does exactly one thing with it — link, or don't.
//
// 🔴 The null case is a REAL state, not a fallback. W5 narrowed chart access to
// an active/recent booking (lib/clientVisibility), so a pro looking at a client
// whose window closed correctly gets no chart link; and a client who never opted
// into a public profile has no public page BY DESIGN (W-series privacy). Both
// must render plain text with NO href in the DOM — never a link to `/u/` or
// `/pro/clients/` that 404s or refuses on arrival.
import ProfileIdentityLink, {
  type ProfileIdentityLinkProps,
} from './ProfileIdentityLink'

export type ClientProfileLinkProps = Omit<
  ProfileIdentityLinkProps,
  'fallbackLabel'
>

/** Links a client's name/avatar to wherever the viewer may go; inert when nowhere. */
export default function ClientProfileLink(props: ClientProfileLinkProps) {
  return <ProfileIdentityLink {...props} fallbackLabel="Client" />
}
