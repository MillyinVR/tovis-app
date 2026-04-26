// app/pro/profile/public-profile/_components/ProProfileCard.tsx
import Link from 'next/link'

import EditPaymentSettingsButton from '../EditPaymentSettingsButton'
import EditProfileButton from '../EditProfileButton'

import type { ProProfileManagementPageModel } from '../_data/proProfileManagementTypes'

type ProProfileCardProps = {
  model: ProProfileManagementPageModel
}

export default function ProProfileCard({ model }: ProProfileCardProps) {
  const avatarLetter = firstDisplayLetter(model.profile.displayName)

  return (
    <section className="brand-pro-profile-card">
      <div className="brand-pro-profile-summary">
        {model.profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={model.profile.avatarUrl}
            alt={model.profile.displayName}
            className="brand-pro-profile-avatar"
          />
        ) : (
          <div className="brand-pro-profile-avatar-fallback" aria-hidden="true">
            {avatarLetter}
          </div>
        )}

        <div className="brand-pro-profile-summary-body">
          <div className="brand-pro-profile-name-row">
            <h1 className="brand-pro-profile-name">
              {model.profile.displayName}
            </h1>

            {model.profile.isApproved ? (
              <span
                className="brand-pro-profile-verified"
                aria-label="Verified professional"
                title="Verified professional"
              >
                ✓
              </span>
            ) : null}
          </div>

          <div className="brand-pro-profile-meta">
            {model.profile.subtitle}
            {model.profile.location ? ` · ${model.profile.location}` : ''}
          </div>

          {model.profile.bio ? (
            <div className="brand-pro-profile-bio">
              “{model.profile.bio}”
            </div>
          ) : (
            <div className="brand-pro-profile-bio">
              Add a short bio so clients know what you specialize in.
            </div>
          )}
        </div>
      </div>

      <div className="brand-pro-profile-card-actions">
        <EditProfileButton
          canEditHandle={model.profile.canEditHandle}
          initial={model.editProfileInitial}
        />

        <EditPaymentSettingsButton initial={model.paymentSettingsInitial} />

        {model.profile.livePublicUrl ? (
          <Link
            href={model.profile.livePublicUrl}
            className="brand-pro-profile-view-client brand-focus"
          >
            View as client <span aria-hidden="true">›</span>
          </Link>
        ) : null}
      </div>
    </section>
  )
}

function firstDisplayLetter(displayName: string): string {
  const trimmed = displayName.trim()

  if (!trimmed) return 'P'

  return trimmed.charAt(0).toUpperCase()
}