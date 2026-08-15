import { Select as KitSelect } from '@/app/_components/ui'

/**
 * Shared <select> for the auth forms — the twin of [Input](./Input.tsx), and a
 * preset over the kit's `Select` for the same reason. It had been declared
 * privately inside SignupProClient with a hand-copied class string, so the one
 * screen with both an input and a select was the one screen where the two could
 * drift apart.
 */
export default function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return <KitSelect surface="soft" {...props} />
}
