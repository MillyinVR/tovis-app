import FieldLabel from '../FieldLabel'
import HelpText from '../HelpText'
import Input from '../Input'
import { FieldErrorText, fieldErrorDescribedBy } from './fieldErrors'

export default function SignupInviteCodeField({
  id,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string
  value: string
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1.5">
      <FieldLabel>Invite code</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        required
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="TVS-XXXX-XXXX-XXXX-XXXX-XXXX"
        disabled={disabled}
        {...fieldErrorDescribedBy(id, error)}
      />
      <HelpText>Private beta: use the one-time code from your invitation.</HelpText>
      <FieldErrorText id={`${id}-error`} message={error} />
    </label>
  )
}
