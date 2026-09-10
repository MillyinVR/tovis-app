import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ClientConsultSuitability from './ClientConsultSuitability'
import ProConsultSuitability from '@/app/pro/_components/consult/ProConsultSuitability'
import { consultSuitabilityCopy as copy } from '@/lib/brand/consultSuitabilityCopy'
import type { ConsultClientSuitabilityDTO, ConsultProSuitabilityDTO } from '@/lib/dto/consult'
const client: ConsultClientSuitabilityDTO = { analysisRevisionId: 'a', clientRevisionId: 'c', whatYouLoved: ['Soft color around my face'], tailoring: [{ explanation: 'Discuss soft color near your face.', needsConfirmation: true }], proConfirmations: ['Your pro can check your starting color.'] }
const pro: ConsultProSuitabilityDTO = { analysisRevisionId: 'a', clientRevisionId: 'c', whatYouLoved: client.whatYouLoved, tailoring: [{ direction: 'Consider copper face framing.', needsConfirmation: true, sources: [{ label: 'Skin undertone', value: 'warm', provenance: 'OBSERVED', revisionId: 'a', confidence: { min: 0.7, max: 0.85 }, evidence: ['face_front'] }] }], proConfirmations: [{ check: 'Assess current tone in person.', sources: [{ label: 'Client preference', value: 'Soft color around my face', provenance: 'CLIENT_REPORTED', revisionId: 'c' }] }] }
describe('role-specific suitability views', () => {
  it('renders the client explanation and uncertainty in plain language', () => {
    render(<ClientConsultSuitability suitability={client} analysisRevisionId="a" copy={copy} />)
    for (const title of [copy.whatYouLoved, copy.tailoring, copy.confirmations]) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByText(copy.needsConfirmation)).toBeInTheDocument()
    expect(screen.queryByText('Consider copper face framing.')).not.toBeInTheDocument()
  })
  it('shows the professional direction, confidence and provenance separately', () => {
    render(<ProConsultSuitability suitability={pro} analysisRevisionId="a" />)
    expect(screen.getByText('Consider copper face framing.')).toBeInTheDocument()
    expect(screen.getByText(copy.observed)).toBeInTheDocument()
    expect(screen.getByText(copy.clientReported)).toBeInTheDocument()
    expect(screen.getByText(/70–85% confidence/)).toBeInTheDocument()
    expect(screen.getByText(copy.professionalNote)).toBeInTheDocument()
  })
  it('hides missing and wrong-revision artifacts on both surfaces', () => {
    const { container, rerender } = render(<ClientConsultSuitability analysisRevisionId="a" copy={copy} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ClientConsultSuitability suitability={client} analysisRevisionId="new" copy={copy} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ProConsultSuitability suitability={pro} analysisRevisionId="new" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ProConsultSuitability analysisRevisionId="a" />)
    expect(container).toBeEmptyDOMElement()
  })
})
