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
import ToggleChip, {
  toggleChipClassName,
} from '@/app/_components/ui/ToggleChip'
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

  // These three elements are <input>/<select>/<textarea>, which match
  // `:focus-visible` on EVERY focus (mouse included — the spec carves out text
  // entry). The unlayered `:focus-visible` rule in globals.css therefore always
  // wins the box-shadow here, so a ring utility on this surface can never paint.
  // Measured on a real auth field: the focused box-shadow is the global
  // `0 0 0 2px bg, 0 0 0 4px accent/.5` with the utility and without it.
  // Asserted as an absence so the dead pair cannot be reintroduced.
  it('leaves the focus RING to the global rule, and shifts the border itself', () => {
    for (const surface of ['dense', 'soft', 'solid'] as const) {
      expect(controlClassName({ surface })).not.toContain('focus:ring')
    }
    for (const surface of ['dense', 'soft'] as const) {
      // `focus:border-*` is the half that does paint — the global rule sets no
      // border-color, so nothing overrides it.
      expect(controlClassName({ surface })).toContain(
        'focus:border-accentPrimary/',
      )
    }
    // `solid` is the exception, and deliberately: the pro fields never carried a
    // focus border, so adding one here would be a restyle of 51 controls rather
    // than a migration. The global ring is their focus indicator.
    expect(controlClassName({ surface: 'solid' })).not.toContain('focus:border')
  })

  it('renders the right elements and forwards props', () => {
    const { container } = render(<TextInput name="slug" placeholder="hair" />)
    const input = container.querySelector('input')
    expect(input?.getAttribute('name')).toBe('slug')
    expect(input?.getAttribute('placeholder')).toBe('hair')
  })

  it('merges caller classes (last wins)', () => {
    expect(controlClassName({ className: 'rounded-full' })).toContain(
      'rounded-full',
    )
    expect(controlClassName({ className: 'rounded-full' })).not.toContain(
      'rounded-xl',
    )
  })

  it('keeps the dense surface as the default', () => {
    expect(controlClassName()).toBe(controlClassName({ surface: 'dense' }))
  })

  it('gives `soft` the card radius and raised fill the auth forms use', () => {
    const soft = controlClassName({ surface: 'soft' })
    expect(soft).toContain('rounded-card')
    expect(soft).toContain('bg-bgSecondary/35')
    expect(soft).toContain('hover:border-surfaceGlass/16')
    // The softer focus border belongs to this surface, not the dense one.
    expect(soft).toContain('focus:border-accentPrimary/35')
    expect(soft).not.toContain('focus:border-accentPrimary/50')
  })

  it('leaves the dense surface free of the soft surface`s additions', () => {
    const dense = controlClassName()
    expect(dense).toContain('rounded-xl')
    expect(dense).toContain('bg-bgPrimary/40')
    // `transition` rides with `soft` only — the admin forms never had one, and
    // this is what stops the variant leaking into them.
    expect(dense).not.toContain('transition')
    expect(dense).not.toContain('hover:')
  })

  it('applies the surface through the components too, not just the helper', () => {
    const { container } = render(
      <>
        <TextInput surface="soft" />
        <Select surface="soft" />
        <Textarea surface="soft" />
      </>,
    )
    const classes = Array.from(container.children).map((el) => el.className)
    expect(new Set(classes).size).toBe(1)
    expect(classes[0]).toBe(controlClassName({ surface: 'soft' }))
  })

  // Splitting one string into BASE + SURFACES is only safe if the dense surface
  // comes out the other side identical — 11 admin files were migrated onto it in
  // the phase-6 admin PR and none of them asked to be restyled. Pinned as a SET,
  // because the split legitimately reorders the tokens and CSS does not care
  // about the order of a class attribute.
  it('emits exactly the dense token set the admin screens were migrated onto', () => {
    const denseBefore =
      'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary ' +
      'placeholder:text-textSecondary/70 outline-none ' +
      'focus:border-accentPrimary/50 focus:ring-2 focus:ring-accentPrimary/20 ' +
      'disabled:cursor-not-allowed disabled:opacity-60'

    const emitted = new Set(controlClassName().split(' '))
    const inherited = new Set(denseBefore.split(' '))

    // Nothing is added.
    expect([...emitted].filter((c) => !inherited.has(c))).toEqual([])
    // The ONLY subtraction is the ring pair, which was measured never to paint
    // on these elements — the unlayered `:focus-visible` rule owns the shadow.
    expect([...inherited].filter((c) => !emitted.has(c)).sort()).toEqual([
      'focus:ring-2',
      'focus:ring-accentPrimary/20',
    ])
  })

  // Same pin for the other direction: `soft` has to reproduce the string the
  // auth forms had been carrying, or promoting them into the kit restyles every
  // login/signup/reset field. The ONE intended difference is the disabled
  // treatment, which becomes a CSS pseudo-class instead of a JS-computed
  // `opacity-70` — asserted explicitly rather than left to the reader.
  it('emits exactly the soft token set the auth forms were carrying', () => {
    const authFieldClasses =
      'w-full rounded-card border px-3 py-2 text-sm outline-none transition ' +
      'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary ' +
      'placeholder:text-textSecondary/70 ' +
      'hover:border-surfaceGlass/16 ' +
      'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15'

    const emitted = new Set(controlClassName({ surface: 'soft' }).split(' '))
    const inherited = new Set(authFieldClasses.split(' '))

    // The only subtraction is the ring pair — measured never to paint here.
    expect([...inherited].filter((c) => !emitted.has(c)).sort()).toEqual([
      'focus:ring-2',
      'focus:ring-accentPrimary/15',
    ])
    expect([...emitted].filter((c) => !inherited.has(c))).toEqual([
      'disabled:cursor-not-allowed',
      'disabled:opacity-60',
    ])
  })

  // And the third direction. `solid` shipped in #913 without a literal pin, so
  // nothing stopped it drifting from the 40 pro controls that came over here
  // afterwards. This is the string those controls were carrying, verbatim — the
  // majority copy, the one behind NewBookingForm's and settingsClient's `field`.
  it('emits exactly the solid token set the pro forms were carrying', () => {
    const proFieldClasses =
      'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 ' +
      'text-[13px] text-textPrimary placeholder:text-textSecondary/70 ' +
      'focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 ' +
      'disabled:opacity-60'

    const emitted = new Set(controlClassName({ surface: 'solid' }).split(' '))
    const inherited = new Set(proFieldClasses.split(' '))

    expect([...inherited].filter((c) => !emitted.has(c)).sort()).toEqual([
      // Dead on these elements — the unlayered `:focus-visible` rule owns the
      // shadow, measured identical with and without the pair.
      'focus:ring-2',
      'focus:ring-accentPrimary/40',
      // `outline-none` unconditionally is a superset of `focus:outline-none`;
      // no browser paints an outline on a resting text control.
      'focus:outline-none',
      // The raw white tint becomes the token. Imperceptible in dark
      // (255,255,255→242,239,231 at 10%); in light it turns a border that was
      // invisible over a near-white page into a hairline.
      'border-white/10',
    ].sort())
    expect([...emitted].filter((c) => !inherited.has(c)).sort()).toEqual([
      'border-surfaceGlass/10',
      'disabled:cursor-not-allowed',
      'outline-none',
    ])
  })

  // The one thing the copies disagreed on. `solid` used to override BASE with a
  // full-opacity placeholder, inherited from the two public-profile modals #913
  // happened to migrate first; 16 of the 17 controls that followed wrote `/70`.
  // Tori settled it at `/70`, so this asserts the ABSENCE of an override — the
  // failure mode is a future edit "restoring" the full-opacity rule.
  it('takes the placeholder alpha from BASE rather than overriding it', () => {
    const solid = controlClassName({ surface: 'solid' })
    expect(solid).toContain('placeholder:text-textSecondary/70')
    expect(solid.split(' ')).not.toContain('placeholder:text-textSecondary')
  })

  it('states the disabled treatment in CSS, for all three surfaces', () => {
    for (const surface of ['dense', 'soft', 'solid'] as const) {
      const cls = controlClassName({ surface })
      expect(cls).toContain('disabled:opacity-60')
      expect(cls).toContain('disabled:cursor-not-allowed')
    }
  })
})

describe('ToggleChip', () => {
  // Two screens had declared this with byte-identical class strings. Pinned as a
  // set so consolidating them cannot quietly restyle either picker.
  const CHIP_CLASSES_BEFORE = {
    base: 'inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[12px] font-bold transition',
    on: 'border-textPrimary/40 bg-bgPrimary text-textPrimary',
    off: 'border-textPrimary/10 bg-bgPrimary/60 text-textSecondary hover:border-textPrimary/20 hover:text-textPrimary',
  }

  it('reproduces both states the two pickers were carrying', () => {
    for (const [selected, state] of [
      [true, CHIP_CLASSES_BEFORE.on],
      [false, CHIP_CLASSES_BEFORE.off],
    ] as const) {
      expect(new Set(toggleChipClassName({ selected }).split(' '))).toEqual(
        new Set(`${CHIP_CLASSES_BEFORE.base} ${state}`.split(' ')),
      )
    }
  })

  it('announces its state as a toggle, which a hand-rolled chip can forget', () => {
    const { getByRole, rerender } = render(<ToggleChip selected>Curly</ToggleChip>)
    expect(getByRole('button', { pressed: true })).toBeTruthy()

    rerender(<ToggleChip selected={false}>Curly</ToggleChip>)
    expect(getByRole('button', { pressed: false })).toBeTruthy()
  })

  it('defaults to type=button so a chip inside a form cannot submit it', () => {
    const { container } = render(<ToggleChip>Curly</ToggleChip>)
    expect(container.querySelector('button')?.type).toBe('button')
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
