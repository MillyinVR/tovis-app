// app/pro/last-minute/LastMinuteWorkspaceClient.tsx
'use client'

import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'

import {
  LastMinuteCreateOpeningPanel,
  LastMinuteOpeningsListPanel,
  LastMinuteOpeningsProvider,
  type OfferingLite,
} from './OpeningsClient'
import LastMinuteSettingsClient from './settingsClient'

type SettingsClientProps = ComponentProps<typeof LastMinuteSettingsClient>

export type LastMinuteWorkspaceInitial = SettingsClientProps['initial'] & {
  offerings: OfferingLite[]
}

type WorkspaceViewportMode = 'mobile' | 'tablet' | 'desktop'
type WorkspaceSection = 'openings' | 'create' | 'settings'

type WorkspaceTab = {
  id: WorkspaceSection
  label: string
  countLabel?: string
}

type ServiceSummary = {
  serviceId: string
  name: string
  basePrice: string
  offeringCount: number
}

const DISABLED_DAY_DEFS = [
  { key: 'disableMon', label: 'Mon' },
  { key: 'disableTue', label: 'Tue' },
  { key: 'disableWed', label: 'Wed' },
  { key: 'disableThu', label: 'Thu' },
  { key: 'disableFri', label: 'Fri' },
  { key: 'disableSat', label: 'Sat' },
  { key: 'disableSun', label: 'Sun' },
] satisfies ReadonlyArray<{
  key: keyof LastMinuteWorkspaceInitial['settings']
  label: string
}>

function readViewportMode(): WorkspaceViewportMode {
  if (typeof window === 'undefined') {
    return 'desktop'
  }

  if (window.matchMedia('(max-width: 767px)').matches) {
    return 'mobile'
  }

  if (window.matchMedia('(max-width: 1199px)').matches) {
    return 'tablet'
  }

  return 'desktop'
}

function useWorkspaceViewportMode(): WorkspaceViewportMode {
  const [mode, setMode] = useState<WorkspaceViewportMode>('desktop')

  useEffect(() => {
    function syncMode() {
      setMode(readViewportMode())
    }

    syncMode()
    window.addEventListener('resize', syncMode)

    return () => {
      window.removeEventListener('resize', syncMode)
    }
  }, [])

  return mode
}

function visibilityLabel(
  mode: LastMinuteWorkspaceInitial['settings']['defaultVisibilityMode'],
): string {
  switch (mode) {
    case 'TARGETED_ONLY':
      return 'Targeted only'
    case 'PUBLIC_IMMEDIATE':
      return 'Public immediately'
    case 'PUBLIC_AT_DISCOVERY':
      return 'Public at discovery'
  }
}

function visibilityDescription(
  mode: LastMinuteWorkspaceInitial['settings']['defaultVisibilityMode'],
): string {
  switch (mode) {
    case 'TARGETED_ONLY':
      return 'Waitlist and reactivation only. Never public.'
    case 'PUBLIC_IMMEDIATE':
      return 'Visible publicly as soon as the opening is created.'
    case 'PUBLIC_AT_DISCOVERY':
      return 'Targeted first, then public when discovery fires.'
  }
}

function minutesToHourLabel(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes)
    ? Math.max(0, Math.trunc(minutes))
    : 0

  if (safeMinutes === 0) {
    return 'Midnight'
  }

  if (safeMinutes % 60 === 0) {
    const hours = safeMinutes / 60
    return `${hours}h`
  }

  const hours = Math.floor(safeMinutes / 60)
  const remainder = safeMinutes % 60

  if (hours === 0) {
    return `${remainder}m`
  }

  return `${hours}h ${remainder}m`
}

function moneyLabel(value: string | null): string {
  const normalized = value?.trim()

  if (!normalized) {
    return 'No floor'
  }

  return `$${normalized}`
}

function timezoneLabel(value: string | null | undefined): string {
  const normalized = value?.trim()

  return normalized || 'Timezone missing'
}

function disabledDayLabels(
  settings: LastMinuteWorkspaceInitial['settings'],
): string[] {
  return DISABLED_DAY_DEFS.filter((day) => settings[day.key] === true).map(
    (day) => day.label,
  )
}

function buildServiceSummaries(
  offerings: LastMinuteWorkspaceInitial['offerings'],
): ServiceSummary[] {
  const summariesByServiceId = new Map<string, ServiceSummary>()

  for (const offering of offerings) {
    const current = summariesByServiceId.get(offering.serviceId)

    if (current) {
      summariesByServiceId.set(offering.serviceId, {
        ...current,
        offeringCount: current.offeringCount + 1,
      })
      continue
    }

    summariesByServiceId.set(offering.serviceId, {
      serviceId: offering.serviceId,
      name: offering.name,
      basePrice: offering.basePrice,
      offeringCount: 1,
    })
  }

  return Array.from(summariesByServiceId.values())
}

function buildTabs(initial: LastMinuteWorkspaceInitial): WorkspaceTab[] {
  return [
    {
      id: 'openings',
      label: 'Openings',
    },
    {
      id: 'create',
      label: 'Create',
      countLabel: String(initial.offerings.length),
    },
    {
      id: 'settings',
      label: 'Settings',
    },
  ]
}

function WorkspaceEyebrow({ children }: { children: ReactNode }) {
  return <div className="lm-workspace-eyebrow">{children}</div>
}

function WorkspaceHeading({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="lm-workspace-heading">
      <WorkspaceEyebrow>Last minute</WorkspaceEyebrow>
      <h1 className="lm-workspace-title">{title}</h1>
      {children ? <p className="lm-workspace-copy">{children}</p> : null}
    </div>
  )
}

function TimezoneWarning({
  timeZone,
}: {
  timeZone: string | null | undefined
}) {
  if (timeZone) {
    return null
  }

  return (
    <div className="lm-timezone-warning" role="status">
      Your timezone is not set yet. Add a valid timezone on your profile before
      relying on last-minute scheduling.
    </div>
  )
}

function SummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'active' | 'warning'
}) {
  return (
    <div className="lm-summary-metric" data-tone={tone}>
      <div className="lm-summary-metric-value">{value}</div>
      <div className="lm-summary-metric-label">{label}</div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  description,
}: {
  label: string
  value: string
  description?: string
}) {
  return (
    <div className="lm-summary-row">
      <div className="lm-summary-row-label">{label}</div>
      <div className="lm-summary-row-value">{value}</div>
      {description ? (
        <div className="lm-summary-row-description">{description}</div>
      ) : null}
    </div>
  )
}

function WorkspaceSummary({
  initial,
}: {
  initial: LastMinuteWorkspaceInitial
}) {
  const services = useMemo(
    () => buildServiceSummaries(initial.offerings),
    [initial.offerings],
  )

  const disabledDays = disabledDayLabels(initial.settings)
  const disabledDaysLabel =
    disabledDays.length > 0 ? disabledDays.join(', ') : 'None'

  return (
    <section className="lm-workspace-summary" aria-label="Last minute summary">
      <div className="lm-summary-metrics">
        <SummaryMetric
          label="Offerings"
          value={initial.offerings.length}
          tone="active"
        />
        <SummaryMetric label="Services" value={services.length} />
        <SummaryMetric
          label="Blocks"
          value={initial.settings.blocks.length}
          tone={initial.settings.blocks.length > 0 ? 'warning' : 'default'}
        />
        <SummaryMetric
          label="Status"
          value={initial.settings.enabled ? 'On' : 'Off'}
          tone={initial.settings.enabled ? 'active' : 'warning'}
        />
      </div>

      <div className="lm-summary-rows">
        <SummaryRow
          label="Default visibility"
          value={visibilityLabel(initial.settings.defaultVisibilityMode)}
          description={visibilityDescription(
            initial.settings.defaultVisibilityMode,
          )}
        />
        <SummaryRow
          label="Floor protection"
          value={moneyLabel(initial.settings.minCollectedSubtotal)}
        />
        <SummaryRow
          label="Tier 2 anchor"
          value={minutesToHourLabel(initial.settings.tier2NightBeforeMinutes)}
        />
        <SummaryRow
          label="Tier 3 anchor"
          value={minutesToHourLabel(initial.settings.tier3DayOfMinutes)}
        />
        <SummaryRow label="Disabled days" value={disabledDaysLabel} />
        <SummaryRow label="Timezone" value={timezoneLabel(initial.timeZone)} />
      </div>
    </section>
  )
}

function ServicePreview({ initial }: { initial: LastMinuteWorkspaceInitial }) {
  const services = useMemo(
    () => buildServiceSummaries(initial.offerings),
    [initial.offerings],
  )

  if (services.length === 0) {
    return (
      <section className="lm-service-preview" aria-label="Service preview">
        <WorkspaceEyebrow>Offerings</WorkspaceEyebrow>
        <div className="lm-empty-note">No active offerings are available.</div>
      </section>
    )
  }

  return (
    <section className="lm-service-preview" aria-label="Service preview">
      <WorkspaceEyebrow>Offerings</WorkspaceEyebrow>

      <div className="lm-service-preview-list">
        {services.map((service) => (
          <div key={service.serviceId} className="lm-service-preview-row">
            <div className="lm-service-preview-main">
              <div className="lm-service-preview-name">{service.name}</div>
              <div className="lm-service-preview-meta">
                From ${service.basePrice}
              </div>
            </div>

            <div className="lm-service-preview-count">
              {service.offeringCount}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function WorkspaceTabButton({
  tab,
  active,
  onClick,
}: {
  tab: WorkspaceTab
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="lm-workspace-tab"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <span>{tab.label}</span>
      {tab.countLabel ? (
        <span className="lm-workspace-tab-count">{tab.countLabel}</span>
      ) : null}
    </button>
  )
}

function SettingsPanel({ initial }: { initial: LastMinuteWorkspaceInitial }) {
  return (
    <section className="lm-workspace-panel" aria-label="Last minute settings">
      <LastMinuteSettingsClient initial={initial} />
    </section>
  )
}

function CreateOpeningPanel() {
  return (
    <section
      className="lm-workspace-panel"
      aria-label="Create last minute opening"
    >
      <LastMinuteCreateOpeningPanel />
    </section>
  )
}

function OpeningsListPanel() {
  return (
    <section className="lm-workspace-panel" aria-label="Last minute openings">
      <LastMinuteOpeningsListPanel />
    </section>
  )
}

function MobileWorkspace({ initial }: { initial: LastMinuteWorkspaceInitial }) {
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>('openings')

  const tabs = useMemo(() => buildTabs(initial), [initial])

  return (
    <LastMinuteOpeningsProvider
      offerings={initial.offerings}
      onCreated={() => setActiveSection('openings')}
    >
      <div className="lm-mobile-workspace">
        <header className="lm-mobile-header">
          <WorkspaceHeading title="Openings.">
            Last-minute availability for the next thing that should not become
            an empty chair.
          </WorkspaceHeading>

          <TimezoneWarning timeZone={initial.timeZone} />

          <nav className="lm-workspace-tabs" aria-label="Last minute sections">
            {tabs.map((tab) => (
              <WorkspaceTabButton
                key={tab.id}
                tab={tab}
                active={activeSection === tab.id}
                onClick={() => setActiveSection(tab.id)}
              />
            ))}
          </nav>
        </header>

        <div className="lm-mobile-content">
          {activeSection === 'openings' ? <OpeningsListPanel /> : null}
          {activeSection === 'create' ? <CreateOpeningPanel /> : null}
          {activeSection === 'settings' ? (
            <SettingsPanel initial={initial} />
          ) : null}
        </div>
      </div>
    </LastMinuteOpeningsProvider>
  )
}

function TabletWorkspace({ initial }: { initial: LastMinuteWorkspaceInitial }) {
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>('create')

  const tabs = useMemo(() => buildTabs(initial), [initial])

  return (
    <LastMinuteOpeningsProvider
      offerings={initial.offerings}
      onCreated={() => setActiveSection('openings')}
    >
      <div className="lm-tablet-workspace">
        <aside className="lm-tablet-sidebar">
          <WorkspaceHeading title="Openings.">
            Structured rollouts across waitlist, reactivation, and discovery.
          </WorkspaceHeading>

          <TimezoneWarning timeZone={initial.timeZone} />

          <WorkspaceSummary initial={initial} />

          <nav className="lm-tablet-nav" aria-label="Last minute sections">
            {tabs.map((tab) => (
              <WorkspaceTabButton
                key={tab.id}
                tab={tab}
                active={activeSection === tab.id}
                onClick={() => setActiveSection(tab.id)}
              />
            ))}
          </nav>

          <ServicePreview initial={initial} />
        </aside>

        <div className="lm-tablet-main">
          {activeSection === 'openings' ? <OpeningsListPanel /> : null}
          {activeSection === 'create' ? <CreateOpeningPanel /> : null}
          {activeSection === 'settings' ? (
            <SettingsPanel initial={initial} />
          ) : null}
        </div>
      </div>
    </LastMinuteOpeningsProvider>
  )
}

function DesktopWorkspace({ initial }: { initial: LastMinuteWorkspaceInitial }) {
  return (
    <LastMinuteOpeningsProvider offerings={initial.offerings}>
      <div className="lm-desktop-workspace">
        <aside className="lm-desktop-sidebar">
          <WorkspaceHeading title="Openings">
            Build last-minute availability once, then let the rollout system do
            the chasing. Like a responsible adult. Suspicious, but useful.
          </WorkspaceHeading>

          <TimezoneWarning timeZone={initial.timeZone} />
          <WorkspaceSummary initial={initial} />
          <ServicePreview initial={initial} />

          <div className="lm-desktop-settings-slot">
            <SettingsPanel initial={initial} />
          </div>
        </aside>

        <main
          className="lm-desktop-main"
          aria-label="Create last minute opening"
        >
          <CreateOpeningPanel />
        </main>

        <aside className="lm-desktop-aside" aria-label="Last minute openings">
          <OpeningsListPanel />
        </aside>
      </div>
    </LastMinuteOpeningsProvider>
  )
}

export default function LastMinuteWorkspaceClient({
  initial,
}: {
  initial: LastMinuteWorkspaceInitial
}) {
  const mode = useWorkspaceViewportMode()

  return (
    <div className="lm-workspace" data-viewport={mode}>
      {mode === 'mobile' ? <MobileWorkspace initial={initial} /> : null}
      {mode === 'tablet' ? <TabletWorkspace initial={initial} /> : null}
      {mode === 'desktop' ? <DesktopWorkspace initial={initial} /> : null}
    </div>
  )
}