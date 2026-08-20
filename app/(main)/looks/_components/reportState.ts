// app/(main)/looks/_components/reportState.ts
//
// The three states a "report this" control moves through, shared by the two
// things a viewer can report on a look: the COMMENT (`CommentsDrawer`) and the
// LOOK itself (`RightActionRail`). Both had — or would have had — the same
// idle/pending/done ternary spelled out inline; keeping one copy is what stops
// the two surfaces drifting into different wording for the same action.
//
// Deliberately NOT in `lib/`: `check-no-private-lib-fork` derives its canonical
// list from exports in `lib` and `app/_components/ui` only, so promoting these
// names would retroactively redden any other private declaration of them.
export type ReportState = 'idle' | 'pending' | 'done'

export const REPORT_LABEL: Record<ReportState, string> = {
  idle: 'Report',
  pending: 'Reporting…',
  done: 'Reported',
}
