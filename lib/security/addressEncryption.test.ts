// lib/security/addressEncryption.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const plaintextByCiphertext = new Map<string, string>()
  let nextCiphertextId = 1

  const encryptAead = vi.fn(
    (args: {
      plaintext: string
      keyVersion: string
      associatedData: string
    }) => {
      const ciphertext = `mock_ciphertext_${nextCiphertextId}`
      nextCiphertextId += 1
      plaintextByCiphertext.set(ciphertext, args.plaintext)

      return {
        v: 1,
        keyVersion: args.keyVersion,
        nonce: 'mock_nonce',
        ciphertext,
        tag: 'mock_tag',
      }
    },
  )

  const decryptAead = vi.fn(
    (args: {
      envelope: { ciphertext?: unknown }
      associatedData: string
    }) => {
      const ciphertext =
        typeof args.envelope.ciphertext === 'string'
          ? args.envelope.ciphertext
          : ''

      const plaintext = plaintextByCiphertext.get(ciphertext)

      if (!plaintext) {
        throw new Error('Mock ciphertext not found')
      }

      return plaintext
    },
  )

  const isAeadEnvelopeV1 = vi.fn((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }

    const envelope = value as Record<string, unknown>

    return (
      envelope.v === 1 &&
      typeof envelope.keyVersion === 'string' &&
      typeof envelope.nonce === 'string' &&
      typeof envelope.ciphertext === 'string' &&
      typeof envelope.tag === 'string'
    )
  })

  const reset = () => {
    plaintextByCiphertext.clear()
    nextCiphertextId = 1
    encryptAead.mockClear()
    decryptAead.mockClear()
    isAeadEnvelopeV1.mockClear()
  }

  return {
    encryptAead,
    decryptAead,
    isAeadEnvelopeV1,
    reset,
  }
})

vi.mock('./crypto/aead', () => ({
  encryptAead: mocks.encryptAead,
  decryptAead: mocks.decryptAead,
  isAeadEnvelopeV1: mocks.isAeadEnvelopeV1,
}))

import {
  ADDRESS_AEAD_ASSOCIATED_DATA,
  ADDRESS_KEY_VERSION,
  buildAddressEnvelope,
  buildAddressPrivacyWriteData,
  buildLegacyAddressPrivacyEnvelopeForBackfill,
  isAddressPrivacyEnvelopeV1,
  readAddressPrivacyEnvelope,
} from './addressEncryption'

describe('addressEncryption', () => {
  beforeEach(() => {
    mocks.reset()
  })

  const input = {
    formattedAddress: ' 123 Main St, Los Angeles, CA 90001 ',
    addressLine1: ' 123 Main St ',
    addressLine2: ' Unit 4 ',
    city: ' Los Angeles ',
    state: ' CA ',
    postalCode: ' 90001 ',
    countryCode: ' us ',
    placeId: ' place_123 ',
    lat: new Prisma.Decimal('34.052235'),
    lng: new Prisma.Decimal('-118.243683'),
  }

  it('builds an encrypted AEAD address envelope by default', () => {
    const envelope = buildAddressEnvelope(input)

    expect(envelope).toEqual({
      v: 1,
      algorithm: 'aes-256-gcm-v1',
      keyVersion: ADDRESS_KEY_VERSION,
      ciphertext: {
        v: 1,
        keyVersion: ADDRESS_KEY_VERSION,
        nonce: 'mock_nonce',
        ciphertext: 'mock_ciphertext_1',
        tag: 'mock_tag',
      },
    })

    expect(mocks.encryptAead).toHaveBeenCalledWith({
      plaintext: JSON.stringify({
        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        addressLine1: '123 Main St',
        addressLine2: 'Unit 4',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_123',
        lat: '34.052235',
        lng: '-118.243683',
      }),
      keyVersion: ADDRESS_KEY_VERSION,
      associatedData: ADDRESS_AEAD_ASSOCIATED_DATA,
    })

    expect(isAddressPrivacyEnvelopeV1(envelope)).toBe(true)

    expect(JSON.stringify(envelope)).not.toContain('123 Main St')
    expect(JSON.stringify(envelope)).not.toContain('Los Angeles')
    expect(JSON.stringify(envelope)).not.toContain('90001')
    expect(JSON.stringify(envelope)).not.toContain('place_123')
    expect(JSON.stringify(envelope)).not.toContain('34.052235')
    expect(JSON.stringify(envelope)).not.toContain('-118.243683')
  })

  it('builds encrypted address privacy write data with searchable coarse fields', () => {
    const writeData = buildAddressPrivacyWriteData(input)

    expect(writeData).toEqual({
      encryptedAddressJson: {
        v: 1,
        algorithm: 'aes-256-gcm-v1',
        keyVersion: ADDRESS_KEY_VERSION,
        ciphertext: {
          v: 1,
          keyVersion: ADDRESS_KEY_VERSION,
          nonce: 'mock_nonce',
          ciphertext: 'mock_ciphertext_1',
          tag: 'mock_tag',
        },
      },
      addressKeyVersion: ADDRESS_KEY_VERSION,
      postalCodePrefix: '90001',
      latApprox: new Prisma.Decimal('34.0522'),
      lngApprox: new Prisma.Decimal('-118.2437'),
    })

    expect(writeData.addressKeyVersion).toBe('address-aead-v1')
    expect(writeData.postalCodePrefix).toBe('90001')
    expect(writeData.latApprox?.toString()).toBe('34.0522')
    expect(writeData.lngApprox?.toString()).toBe('-118.2437')

    expect(JSON.stringify(writeData.encryptedAddressJson)).not.toContain(
      '123 Main St',
    )
    expect(JSON.stringify(writeData.encryptedAddressJson)).not.toContain(
      'place_123',
    )
  })

  it('decrypts the encrypted address envelope back to the normalized payload', () => {
    const envelope = buildAddressEnvelope(input)

    const payload = readAddressPrivacyEnvelope(envelope)

    expect(mocks.decryptAead).toHaveBeenCalledWith({
      envelope: {
        v: 1,
        keyVersion: ADDRESS_KEY_VERSION,
        nonce: 'mock_nonce',
        ciphertext: 'mock_ciphertext_1',
        tag: 'mock_tag',
      },
      associatedData: ADDRESS_AEAD_ASSOCIATED_DATA,
    })

    expect(payload).toEqual({
      formattedAddress: '123 Main St, Los Angeles, CA 90001',
      addressLine1: '123 Main St',
      addressLine2: 'Unit 4',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      placeId: 'place_123',
      lat: '34.052235',
      lng: '-118.243683',
    })
  })

  it('supports legacy plaintext envelopes for backfill/read compatibility only', () => {
    const envelope = buildLegacyAddressPrivacyEnvelopeForBackfill(input)

    expect(envelope).toEqual({
      v: 1,
      algorithm: 'plaintext-json-expand-phase',
      keyVersion: 'address-json-v1',
      address: {
        formattedAddress: '123 Main St, Los Angeles, CA 90001',
        addressLine1: '123 Main St',
        addressLine2: 'Unit 4',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        placeId: 'place_123',
        lat: '34.052235',
        lng: '-118.243683',
      },
    })

    expect(isAddressPrivacyEnvelopeV1(envelope)).toBe(true)
    expect(readAddressPrivacyEnvelope(envelope)).toEqual(envelope.address)
    expect(mocks.encryptAead).not.toHaveBeenCalled()
    expect(mocks.decryptAead).not.toHaveBeenCalled()
  })

  it('normalizes empty address fields to null', () => {
    const envelope = buildAddressEnvelope({
      formattedAddress: '   ',
      addressLine1: '',
      addressLine2: null,
      city: undefined,
      state: ' CA ',
      postalCode: '  ',
      countryCode: ' us ',
      placeId: '',
      lat: null,
      lng: undefined,
    })

    expect(readAddressPrivacyEnvelope(envelope)).toEqual({
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: 'CA',
      postalCode: null,
      countryCode: 'US',
      placeId: null,
      lat: null,
      lng: null,
    })
  })

  it('returns null coarse fields when postal code or coordinates are absent or invalid', () => {
    const writeData = buildAddressPrivacyWriteData({
      postalCode: '   ',
      lat: 'not-a-number',
      lng: undefined,
    })

    expect(writeData.postalCodePrefix).toBeNull()
    expect(writeData.latApprox).toBeNull()
    expect(writeData.lngApprox).toBeNull()
  })

  it('rejects malformed address envelopes', () => {
    expect(
      isAddressPrivacyEnvelopeV1({
        v: 1,
        algorithm: 'aes-256-gcm-v1',
        keyVersion: ADDRESS_KEY_VERSION,
        ciphertext: {
          v: 1,
          keyVersion: ADDRESS_KEY_VERSION,
          associatedData: ADDRESS_AEAD_ASSOCIATED_DATA,
        },
      }),
    ).toBe(false)

    expect(
      isAddressPrivacyEnvelopeV1({
        v: 1,
        algorithm: 'plaintext-json-expand-phase',
        keyVersion: 'address-json-v1',
        address: {
          formattedAddress: '123 Main St',
        },
      }),
    ).toBe(false)
  })
})