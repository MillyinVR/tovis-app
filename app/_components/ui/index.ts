// app/_components/ui/index.ts
//
// Shared UI primitives. Import canonical Button/Card/Avatar from here rather than
// re-rolling per screen.
export { default as Button, buttonClassName } from './Button'
export type {
  ButtonProps,
  ButtonStyleOptions,
  ButtonVariant,
  ButtonSize,
  ButtonShape,
} from './Button'

export { default as Card } from './Card'
export type {
  CardProps,
  CardVariant,
  CardPadding,
  CardElevation,
} from './Card'

export { default as Avatar } from './Avatar'
export type { AvatarProps, AvatarSize, AvatarFill } from './Avatar'
