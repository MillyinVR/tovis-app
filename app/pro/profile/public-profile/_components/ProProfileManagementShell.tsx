// app/pro/profile/public-profile/_components/ProProfileManagementShell.tsx
import ServicesManagerSection from '../../_sections/ServicesManagerSection'

import type { ProProfileManagementPageModel } from '../_data/proProfileManagementTypes'
import type { WorkspaceOption } from '@/lib/auth/workspaces'

import ProAccountSection from './ProAccountSection'
import ProPortfolioGrid from './ProPortfolioGrid'
import ProProfileActions from './ProProfileActions'
import ProProfileCard from './ProProfileCard'
import ProProfileHeader from './ProProfileHeader'
import ProProfileStats from './ProProfileStats'
import ProProfileTabs from './ProProfileTabs'
import ProReviewSection from './ProReviewsSection'
import YourLinkCard from './YourLinkCard'

type ProProfileManagementShellProps = {
  model: ProProfileManagementPageModel
  workspaces?: WorkspaceOption[]
}

export default function ProProfileManagementShell({
  model,
  workspaces = [],
}: ProProfileManagementShellProps) {
  return (
    <main className="brand-pro-profile-page">
      <div className="brand-pro-profile-shell">
        <ProProfileHeader
          routes={model.routes}
          unreadNotificationCount={model.unreadNotificationCount}
        />

        <div className="brand-pro-profile-scroll no-scroll">
          {!model.profile.isApproved ? (
            <ApprovalNotice brandDisplayName={model.brandDisplayName} />
          ) : null}

          <ProProfileCard model={model} />
          <YourLinkCard
            handle={model.profile.handle}
            isApproved={model.profile.isApproved}
            isPremium={model.profile.isPremium}
            vanityHost={model.profile.vanityHost}
            vanityUrl={model.profile.vanityUrl}
            vanityQrSvg={model.profile.vanityQrSvg}
          />
          <ProProfileStats stats={model.stats} />
          <ProProfileActions routes={model.routes} />

          <ProProfileTabs activeTab={model.tab} routes={model.routes} />

          {model.tab === 'portfolio' ? (
            <ProPortfolioGrid
              routes={model.routes}
              portfolio={model.portfolio}
            />
          ) : null}

          {model.tab === 'services' ? <ServicesTab /> : null}

          {model.tab === 'reviews' ? (
            <ProReviewSection reviews={model.reviews} />
          ) : null}

          <ProAccountSection workspaces={workspaces} />

          <div className="brand-pro-profile-bottom-spacer" aria-hidden="true" />
        </div>
      </div>
    </main>
  )
}

function ApprovalNotice({
  brandDisplayName,
}: {
  brandDisplayName: string
}) {
  return (
    <section className="brand-pro-profile-card" aria-live="polite">
      <div className="brand-pro-profile-service-title">
        Your profile is under review
      </div>

      <p className="brand-pro-profile-notice-copy">
        Your public profile is not live yet. While review is pending, you are not
        searchable, not publicly bookable, and clients cannot view your public
        profile yet.
      </p>

      <p className="brand-pro-profile-notice-copy">
        You can keep setting up your services, portfolio, and payment details
        here while {brandDisplayName} reviews your account.
      </p>
    </section>
  )
}

function ServicesTab() {
  return (
    <section className="brand-pro-profile-services" aria-label="Services">
      <ServicesManagerSection
        variant="section"
        title={null}
        subtitle={null}
      />
    </section>
  )
}