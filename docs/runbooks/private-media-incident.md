# Private Media Incident Runbook

This runbook defines how TOVIS should respond if private media, verification documents, signed URLs, storage paths, or related metadata may have been exposed to an unauthorized party.

This is a launch-readiness baseline. It should be reviewed before public launch and updated after every incident, tabletop exercise, or storage/auth change.

## Scope

This runbook applies to private or restricted media, including:

- Before photos.
- After photos.
- Client-uploaded booking media.
- Verification documents.
- License or identity review documents.
- Private review media before publication.
- Private profile/avatar media.
- Thumbnails or derivatives of private media.
- Storage paths for private objects.
- Signed URLs for private objects.
- Media metadata that reveals private service, client, Pro, address, or booking context.

This runbook does **not** apply to intentionally public profile/portfolio/review media unless the incident involves unauthorized publishing, incorrect ownership, or accidental exposure of private metadata.

## Severity levels

| Severity | Definition | Examples |
|---|---|---|
| SEV0 | Confirmed broad exposure of private media or storage credentials. | Public listing of `media-private`; leaked Supabase service role key; many private photos publicly accessible. |
| SEV1 | Confirmed unauthorized access to one or more private media objects. | User received another client’s before/after photo; signed URL sent to wrong recipient; private media exposed through API bug. |
| SEV2 | Possible exposure with limited evidence or narrow blast radius. | Logs contain signed URLs; support ticket includes private media link; stale signed URLs active longer than expected. |
| SEV3 | Near miss or policy drift without confirmed access. | Storage policy drift detected; test shows anonymous read would be possible in staging; private path appears in non-public logs. |

## Goals

During an incident, prioritize:

1. Stop further exposure.
2. Preserve evidence.
3. Identify affected users/media/bookings.
4. Revoke access where possible.
5. Rotate compromised credentials if needed.
6. Communicate clearly to users and internal owners.
7. Fix the root cause.
8. Add tests or monitoring so it does not happen again.

## Incident commander checklist

Assign an incident commander immediately for SEV0, SEV1, or any unclear exposure.

The incident commander owns:

- Severity classification.
- Timeline.
- Task assignment.
- User impact analysis.
- Decision log.
- Escalation.
- Final post-incident review.

Create an incident document or ticket with:

```text
incidentId
severity
openedAt
incidentCommander
status
summary
suspectedStartTime
suspectedEndTime
affectedBuckets
affectedObjectCount
affectedUserCount
affectedBookingCount
affectedProfessionalCount
affectedClientCount
rootCause
containmentActions
communications
followUpTasks
closedAt