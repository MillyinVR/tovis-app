// app/(auth)/_components/signup/pro/ProBrandingFields.tsx
//
// The two optional things a pro can name themselves by at signup: a business
// name and a handle. Both are optional on purpose — neither is allowed to block
// an account being created — and the handle preview has to show the normalized
// form, because that is what actually gets claimed.

'use client'

import FieldLabel from '../../FieldLabel'
import HelpText from '../../HelpText'
import Input from '../../Input'
import { sanitizeHandleInput } from '@/lib/handles'
import { useBrand } from '@/lib/brand/BrandProvider'

export default function ProBrandingFields({
  businessName,
  onBusinessNameChange,
  handle,
  onHandleChange,
}: {
  businessName: string
  onBusinessNameChange: (next: string) => void
  handle: string
  onHandleChange: (next: string) => void
}) {
  const { brand } = useBrand()

  const handlePreview = sanitizeHandleInput(handle.trim())
  const handleIsTrimmed = handle.trim() !== handlePreview

  return (
    <>
      <label className="grid gap-1.5">
        <FieldLabel>Business name (optional)</FieldLabel>
        <Input
          value={businessName}
          onChange={(e) => onBusinessNameChange(e.target.value)}
          placeholder={`e.g. Salon De ${brand.displayName}`}
          autoComplete="organization"
        />
        <HelpText>You can add this later — we won’t block signup.</HelpText>
      </label>

      <label className="grid gap-1.5">
        <FieldLabel>Handle (optional)</FieldLabel>
        <Input
          value={handle}
          onChange={(e) => onHandleChange(e.target.value)}
          placeholder={`e.g. iLove${brand.displayName}`}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <HelpText>
          Optional for now. If you enter one, it will be normalized to{' '}
          <span className="font-black text-textPrimary">
            {handlePreview || 'your-handle'}
          </span>
          {handleIsTrimmed ? (
            <span className="text-toneWarn"> (we’ll trim symbols)</span>
          ) : null}
        </HelpText>
      </label>
    </>
  )
}
