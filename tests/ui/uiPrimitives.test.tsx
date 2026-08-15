// tests/ui/uiPrimitives.test.tsx
//
// Locks the canonical scale of the shared UI primitives so the converged
// Button/Card/Avatar styling can't silently drift back into bespoke per-screen
// values.
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Avatar from '@/app/_components/ui/Avatar'
import Badge, { badgeClassName } from '@/app/_components/ui/Badge'
import Button, { buttonClassName } from '@/app/_components/ui/Button'
import Card from '@/app/_components/ui/Card'
import FieldLabel from '@/app/_components/ui/FieldLabel'
import {
  Select,
  Textarea,
  TextInput,
  controlClassName,
} from '@/app/_components/ui/controls'

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

describe('Badge fill', () => {
  it('is border-only by default — no background', () => {
    const cls = badgeClassName()
    expect(cls).toContain('border-textPrimary/12')
    expect(cls).not.toMatch(/\bbg-/)
  })

  it('adds the tinted fill each tone had re-authored by hand', () => {
    expect(badgeClassName({ fill: 'soft' })).toContain('bg-bgSecondary')
    expect(badgeClassName({ tone: 'success', fill: 'soft' })).toContain(
      'bg-toneSuccess/10',
    )
    expect(badgeClassName({ tone: 'accent', fill: 'soft' })).toContain(
      'bg-accentPrimary/10',
    )
  })

  it('keeps the tone border/text when filled', () => {
    const cls = badgeClassName({ tone: 'danger', fill: 'soft' })
    expect(cls).toContain('border-toneDanger/30')
    expect(cls).toContain('text-toneDanger')
  })

  it('renders the fill through the component', () => {
    const { container } = render(
      <Badge tone="warn" fill="soft">
        Unsaved
      </Badge>,
    )
    expect(container.firstElementChild?.className).toContain('bg-toneWarn/10')
  })
})

describe('Button accent/neutral variants and fill', () => {
  it('exposes the accent variant the admin forms needed', () => {
    const cls = buttonClassName({ variant: 'accent' })
    expect(cls).toContain('border-accentPrimary/45')
    expect(cls).toContain('text-accentPrimary')
    // Outlined until asked to fill.
    expect(cls).not.toContain('bg-accentPrimary/15')
  })

  it('fills the accent and neutral variants on request', () => {
    expect(buttonClassName({ variant: 'accent', fill: 'soft' })).toContain(
      'bg-accentPrimary/15',
    )
    expect(buttonClassName({ variant: 'neutral', fill: 'soft' })).toContain(
      'bg-bgSecondary',
    )
  })

  it('leaves the already-filled primary variant alone', () => {
    const filled = buttonClassName({ variant: 'primary', fill: 'soft' })
    expect(filled).toBe(buttonClassName({ variant: 'primary' }))
  })

  it('lets the fill win the resting/hover background for danger', () => {
    const cls = buttonClassName({ variant: 'danger', fill: 'soft' })
    expect(cls).toContain('bg-toneDanger/10')
    expect(cls).toContain('hover:bg-toneDanger/15')
    // twMerge must drop the variant's weaker hover, not keep both.
    expect(cls).not.toContain('hover:bg-toneDanger/10')
  })
})

describe('form controls', () => {
  it('gives input, select and textarea ONE surface', () => {
    const { container } = render(
      <>
        <TextInput />
        <Select />
        <Textarea />
      </>,
    )
    const classes = Array.from(container.children).map((el) => el.className)
    expect(new Set(classes).size).toBe(1)
    expect(classes[0]).toBe(controlClassName())
  })

  it('carries an accent focus ring, not just a border shift', () => {
    expect(controlClassName()).toContain('focus:ring-2')
    expect(controlClassName()).toContain('focus:ring-accentPrimary/20')
  })

  it('renders the right elements and forwards props', () => {
    const { container } = render(<TextInput name="slug" placeholder="hair" />)
    const input = container.querySelector('input')
    expect(input?.getAttribute('name')).toBe('slug')
    expect(input?.getAttribute('placeholder')).toBe('hair')
  })

  it('merges caller classes (last wins)', () => {
    expect(controlClassName('rounded-full')).toContain('rounded-full')
    expect(controlClassName('rounded-full')).not.toContain('rounded-xl')
  })
})

describe('FieldLabel', () => {
  it('renders the one converged label weight', () => {
    const { container } = render(<FieldLabel>Name</FieldLabel>)
    const el = container.firstElementChild
    expect(el?.tagName).toBe('DIV')
    expect(el?.className).toContain('font-black')
    expect(el?.className).toContain('text-textSecondary')
  })

  it('can render inline inside a <label>', () => {
    const { container } = render(<FieldLabel as="span">Name</FieldLabel>)
    expect(container.firstElementChild?.tagName).toBe('SPAN')
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
