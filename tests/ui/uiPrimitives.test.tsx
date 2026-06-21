// tests/ui/uiPrimitives.test.tsx
//
// Locks the canonical scale of the shared UI primitives so the converged
// Button/Card/Avatar styling can't silently drift back into bespoke per-screen
// values.
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Avatar from '@/app/_components/ui/Avatar'
import Button, { buttonClassName } from '@/app/_components/ui/Button'
import Card from '@/app/_components/ui/Card'

describe('buttonClassName', () => {
  it('defaults to a primary, pill, md button', () => {
    const cls = buttonClassName()
    expect(cls).toContain('rounded-full') // pill is the app-wide default
    expect(cls).toContain('h-11') // md height
    expect(cls).toContain('bg-cta') // primary fill
    expect(cls).not.toContain('w-full')
  })

  it('opts into the soft (rounded-[14px]) shape', () => {
    expect(buttonClassName({ shape: 'soft' })).toContain('rounded-[14px]')
  })

  it('maps each size to its canonical height', () => {
    expect(buttonClassName({ size: 'xs' })).toContain('h-8')
    expect(buttonClassName({ size: 'sm' })).toContain('h-9')
    expect(buttonClassName({ size: 'lg' })).toContain('h-[46px]')
  })

  it('applies ghost/danger/success variants and fullWidth', () => {
    expect(buttonClassName({ variant: 'ghost' })).toContain('text-textSecondary')
    expect(buttonClassName({ variant: 'danger' })).toContain('text-toneDanger')
    expect(buttonClassName({ variant: 'success' })).toContain('text-toneSuccess')
    expect(buttonClassName({ fullWidth: true })).toContain('w-full')
  })

  it('merges caller classes via tailwind-merge (last wins)', () => {
    // soft shape then a className override of rounded should resolve to the override
    expect(buttonClassName({ shape: 'soft', className: 'rounded-full' })).toContain(
      'rounded-full',
    )
  })
})

describe('Button', () => {
  it('renders a button with type="button" by default', () => {
    const { getByRole } = render(<Button>Go</Button>)
    const btn = getByRole('button')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.className).toContain('bg-cta')
  })
})

describe('Card', () => {
  it('renders a surface div with canonical padding by default', () => {
    const { container } = render(<Card>body</Card>)
    const el = container.firstElementChild
    expect(el?.tagName).toBe('DIV')
    expect(el?.className).toContain('rounded-card')
    expect(el?.className).toContain('bg-bgSurface')
    expect(el?.className).toContain('p-4') // canonical converged padding
  })

  it('renders as a section landmark with md elevation when asked', () => {
    const { container } = render(
      <Card as="section" elevation="md">
        body
      </Card>,
    )
    const el = container.firstElementChild
    expect(el?.tagName).toBe('SECTION')
    expect(el?.className).toContain('shadow-[0_16px_40px_rgb(var(--shadow-color)/0.14)]')
  })
})

describe('Avatar', () => {
  it('is always a circle and derives initials from the name', () => {
    const { container } = render(<Avatar name="Ada Lovelace" />)
    const el = container.firstElementChild
    expect(el?.className).toContain('rounded-full')
    expect(el?.textContent).toBe('AL')
  })

  it('honors an explicit initials override and neutral fill', () => {
    const { container } = render(<Avatar initials="?" fill="neutral" aria-hidden />)
    const el = container.firstElementChild
    expect(el?.textContent).toBe('?')
    expect(el?.className).toContain('bg-bgSecondary')
    expect(el?.getAttribute('aria-hidden')).toBe('true')
  })
})
