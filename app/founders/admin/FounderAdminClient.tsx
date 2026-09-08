'use client'

import { useState } from 'react'
import type { FounderSpecialty } from '@prisma/client'

import type { FounderAdminSummaryDTO } from '@/lib/dto/founders'

const SPECIALTIES: readonly { value: FounderSpecialty; label: string }[] = [
  { value: 'HAIR', label: 'Hair' },
  { value: 'NAILS', label: 'Nails' },
  { value: 'LASHES_BROWS', label: 'Lashes & brows' },
  { value: 'SKINCARE', label: 'Skincare' },
  { value: 'MAKEUP', label: 'Makeup' },
  { value: 'PERMANENT_MAKEUP', label: 'Permanent makeup' },
  { value: 'EXTENSIONS', label: 'Extensions' },
  { value: 'WAXING_SPRAY_TAN', label: 'Waxing & spray tan' },
  { value: 'BARBER', label: 'Barber' },
]

type SummaryEnvelope = { ok: true; summary: FounderAdminSummaryDTO }

export default function FounderAdminClient({
  initialSummary,
}: {
  initialSummary: FounderAdminSummaryDTO
}) {
  const [summary, setSummary] = useState(initialSummary)
  const [proEmail, setProEmail] = useState('')
  const [specialty, setSpecialty] = useState<FounderSpecialty>('HAIR')
  const [clientEmail, setClientEmail] = useState('')
  const [sponsorEmail, setSponsorEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    const response = await fetch('/api/v1/founders/admin', {
      credentials: 'include',
      cache: 'no-store',
    })
    if (response.ok) {
      const payload: SummaryEnvelope = await response.json()
      setSummary(payload.summary)
    }
  }

  async function enroll(input: Record<string, string>, success: string) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/v1/founders/admin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload: { ok: boolean; error?: string } = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Enrollment failed.')
      setNotice(success)
      await refresh()
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Enrollment failed.')
    } finally {
      setBusy(false)
    }
  }

  async function moderateReport(reportId: string, action: 'HIDE' | 'RESOLVE') {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/v1/founders/admin', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId, action }),
      })
      const payload: { ok: boolean; error?: string } = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Moderation failed.')
      setNotice(action === 'HIDE' ? 'Message hidden and report resolved.' : 'Report resolved.')
      await refresh()
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : 'Moderation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="founder-admin-title"><small>OWNER VIEW</small><h1>Founder administration</h1><p>Control admission, watch feedback health, and answer every room from one place.</p></header>
      <section className="founder-admin-metrics">
        <article><strong>{summary.proSeatsUsed}</strong><span>of 100 pro seats</span></article>
        <article><strong>{summary.proSeatsRemaining}</strong><span>pro seats remaining</span></article>
        <article><strong>{summary.activeClients}</strong><span>founding clients</span></article>
        <article><strong>{summary.unansweredQuestions}</strong><span>questions to answer</span></article>
        <article><strong>{summary.openReports}</strong><span>reports to review</span></article>
      </section>

      <section className="founder-admin-forms">
        <form onSubmit={(event) => { event.preventDefault(); void enroll({ audience: 'PRO', email: proEmail, specialty }, 'Founding professional added.'); }}>
          <h2>Add a founding professional</h2><p>The account must already have a professional profile.</p>
          <label>Email<input type="email" required value={proEmail} onChange={(event) => setProEmail(event.target.value)} /></label>
          <label>Specialty<select value={specialty} onChange={(event) => setSpecialty(event.target.value as FounderSpecialty)}>{SPECIALTIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button type="submit" disabled={busy || summary.proSeatsRemaining === 0}>Add professional</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void enroll({ audience: 'CLIENT', email: clientEmail, sponsorEmail }, 'Founding client added to their circle.'); }}>
          <h2>Add a founding client</h2><p>The client must already be connected to their sponsoring founding pro.</p>
          <label>Client email<input type="email" required value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} /></label>
          <label>Sponsor pro email<input type="email" required value={sponsorEmail} onChange={(event) => setSponsorEmail(event.target.value)} /></label>
          <button type="submit" disabled={busy}>Add client</button>
        </form>
      </section>
      {notice ? <p className="founder-admin-notice" role="status">{notice}</p> : null}

      {summary.reports.length > 0 ? (
        <section className="founder-admin-roster">
          <h2>Reports needing review</h2>
          {summary.reports.map((report) => (
            <article key={report.id} className="founder-admin-report">
              <strong>{report.reason.replaceAll('_', ' ').toLowerCase()}</strong>
              <span>{report.message.author.displayName} · {report.message.room.replaceAll('_', ' ')}</span>
              <p>{report.message.body}</p>
              {report.details ? <small>{report.details}</small> : null}
              <div>
                <button type="button" disabled={busy} onClick={() => void moderateReport(report.id, 'HIDE')}>Hide message</button>
                <button type="button" disabled={busy} onClick={() => void moderateReport(report.id, 'RESOLVE')}>Keep & resolve</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="founder-admin-roster"><h2>Founding roster</h2><div className="founder-admin-table"><table><thead><tr><th>Name</th><th>Group</th><th>Specialty / circle</th><th>Sponsor</th><th>Status</th></tr></thead><tbody>{summary.members.map((member) => <tr key={member.id}><td>{member.displayName}</td><td>{member.audience === 'PRO' ? 'Professional' : 'Client'}</td><td>{member.specialty?.replaceAll('_', ' ') ?? (member.clientSlot ? `Client Circle ${member.clientSlot}` : '—')}</td><td>{member.sponsorName ?? '—'}</td><td>{member.removedAt ? 'Removed' : member.role}</td></tr>)}</tbody></table></div></section>
    </>
  )
}
