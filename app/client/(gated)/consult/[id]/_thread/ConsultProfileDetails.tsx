'use client'

import type { ConsultClientResultsDTO } from '@/lib/dto/consult'
import { useBrand } from '@/lib/brand/BrandProvider'

/** On-demand detail keeps the conversation short without hiding its evidence. */
export default function ConsultProfileDetails({ results }: { results: ConsultClientResultsDTO }) {
  const { brand } = useBrand()
  const copy = brand.clientConsultResults
  return (
    <details className="rounded-xl border border-surfaceGlass/10 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-textPrimary">{copy.profileTitle}</summary>
      <p className="mt-2 text-sm text-textSecondary">{copy.profileBody}</p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {(Object.entries(results.profile) as Array<[
          keyof typeof results.profile,
          (typeof results.profile)[keyof typeof results.profile],
        ]>).map(([field, observation]) => observation ? (
          <div key={field}>
            <dt className="text-xs text-textMuted">{copy.profileLabels[field]}</dt>
            <dd className="text-sm text-textPrimary">{observation.value.toLowerCase().replaceAll('_', ' ')}</dd>
          </div>
        ) : null)}
      </dl>
      <h4 className="mt-4 text-sm font-semibold text-textPrimary">{copy.styleDirectionsTitle}</h4>
      <p className="mt-1 text-sm text-textSecondary">{copy.styleDirectionsBody}</p>
      {results.styleDirections.map((direction) => (
        <div key={direction.domain} className="mt-3 text-sm text-textSecondary">
          <p className="font-semibold text-textPrimary">{direction.title}</p>
          <p>{direction.direction}</p>
          <p className="mt-1">{copy.whyItFlattersLabel}: {direction.whyItFlatters}</p>
        </div>
      ))}
    </details>
  )
}
