// app/_components/ui/index.ts
//
// Shared UI primitives. Import canonical Button/Card/Avatar/Badge from here rather
// than re-rolling per screen.
export { default as Button, buttonClassName } from './Button'
export type {
  ButtonProps,
  ButtonStyleOptions,
  ButtonVariant,
  ButtonSize,
  ButtonShape,
  ButtonFill,
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

export { default as CardLinkOverlay } from './CardLinkOverlay'
export type { CardLinkOverlayProps } from './CardLinkOverlay'

export { default as Badge, badgeClassName } from './Badge'
export type {
  BadgeProps,
  BadgeStyleOptions,
  BadgeTone,
  BadgeSize,
  BadgeFill,
} from './Badge'

export { default as FieldLabel } from './FieldLabel'
export type { FieldLabelProps } from './FieldLabel'

export { default as ToggleChip, toggleChipClassName } from './ToggleChip'
export type { ToggleChipProps, ToggleChipStyleOptions } from './ToggleChip'

export { TextInput, Select, Textarea, controlClassName } from './controls'
export type {
  TextInputProps,
  SelectProps,
  TextareaProps,
  ControlSurface,
  ControlStyleOptions,
} from './controls'
