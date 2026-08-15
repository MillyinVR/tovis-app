import { TextInput } from '@/app/_components/ui'

/**
 * Shared text input for the auth forms (login, signup, reset). Keeps the field
 * styling identical across every auth screen.
 *
 * This is a PRESET, not a style of its own: the kit's `TextInput` owns the class
 * strings and this file only binds the surface the auth screens use. It had been
 * a full copy of them, which is how it drifted from the same field in client
 * settings — same design, two spellings, neither one canonical.
 */
export default function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput surface="soft" {...props} />
}
