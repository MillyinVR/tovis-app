-- W5 follow-up: the pro→client chart-access request loop gets notified.
--
-- W5 shipped the consent row (ClientChartShare) and both write paths — a pro
-- can already POST a REQUESTED row and a client can already GRANT one. What it
-- never shipped is any way for either side to LEARN that happened: the request
-- was a silent row, so a client only discovered it by happening to open
-- /client/settings, and a pro only discovered a grant by re-opening a chart
-- that had refused them. An ask nobody is told about is not an ask.
--
-- Two additive enum values. Postgres cannot add a value to an enum inside a
-- transaction block that later USES it; nothing here uses them — Prisma runs
-- each migration file in its own transaction and these are the only statements.
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'CHART_ACCESS_REQUESTED';
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'CHART_ACCESS_GRANTED';
