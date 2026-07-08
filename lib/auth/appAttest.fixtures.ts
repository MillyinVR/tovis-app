// lib/auth/appAttest.fixtures.ts
//
// GENERATED test fixture — a self-contained App Attest attestation signed by a
// THROWAWAY root CA (not Apple's), so lib/auth/appAttest.test.ts can exercise the
// full verifier hermetically (no runtime openssl, no real device). Regenerate
// with `node scripts/gen-app-attest-fixture.mjs`.

/** The throwaway root the fixture chain is signed by (NOT the Apple root). */
export const FIXTURE_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBkzCCATmgAwIBAgIUO/rVr/Vr7akPzHe6jPl0l3GEEgIwCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwUVGVzdCBBcHAgQXR0ZXN0IFJvb3QwHhcNMjYwNzA4MDkzMTI5
WhcNMzYwNzA1MDkzMTI5WjAfMR0wGwYDVQQDDBRUZXN0IEFwcCBBdHRlc3QgUm9v
dDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABFECFxL5QXUBDrKK0Iosky/kzPHv
MsVMNAdBEbp8W86s5xpQgfwIJ0cBaiPnDlM5pv+BhFVxvKFsGe03WXJ5vSujUzBR
MB0GA1UdDgQWBBSsI6zbTO1Wy3lE6OaqQtJQFI9IxDAfBgNVHSMEGDAWgBSsI6zb
TO1Wy3lE6OaqQtJQFI9IxDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gA
MEUCIHSipaibIsVp+I6VZeSkalcAIdRScL1y6kfYY/X5E+lDAiEAq0sG9NSRl2gR
LtTN5cmcT14WEkezUZOt5cNh2ykbfnI=
-----END CERTIFICATE-----`

/** App id ("TEAMID.bundleId") baked into the fixture's rpIdHash. */
export const FIXTURE_APP_ID = '00A0B0C0D0.com.example.appattest'

/** base64 key id = SHA256 of the attested public key. */
export const FIXTURE_KEY_ID = 'Yo+ty5c80wkwys9J+l1eUsFkGS+GgijYdLfmbMFI0Q8='

/** base64 clientDataHash the fixture attestation's nonce was computed over. */
export const FIXTURE_CLIENT_DATA_HASH_B64 = 'yGq0zzmhKr5LJBK+PqRkpg3ZRsfYVd7YPvz1fQBvkq4='

// The registration inputs the fixture's clientDataHash was derived from, i.e.
// SHA256(`${FIXTURE_EMAIL}\n${FIXTURE_PHONE}\n${FIXTURE_TIMESTAMP}`). Pin
// Date.now() near FIXTURE_TIMESTAMP to exercise the gate's freshness window.
export const FIXTURE_EMAIL = 'att-client@example.com'
export const FIXTURE_PHONE = '+15555550123'
export const FIXTURE_TIMESTAMP = 1800000000000

/** base64 CBOR attestation object (fmt apple-appattest). */
export const FIXTURE_ATTESTATION_B64 =
  'o2NmbXRvYXBwbGUtYXBwYXR0ZXN0Z2F0dFN0bXSiY3g1Y4JZAbkwggG1MIIBW6ADAgECAhRPtk290ANqTumJf7oP5M+tabsBgjAKBggqhkjOPQQDAjAdMRswGQYDVQQDDBJUZXN0IEFwcCBBdHRlc3QgQ0EwHhcNMjYwNzA4MDkzMTI5WhcNMzYwNzA1MDkzMTI5WjAfMR0wGwYDVQQDDBRUZXN0IEFwcCBBdHRlc3QgTGVhZjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABE6nS6jMfO1medMzzRkMmgekKZbVwz+SHOkF2k8MaI9Qo7+Sr3p0YcyTVDDTQzp8Ri41swAyB9weRQ+CSZdN8aujdzB1MDMGCSqGSIb3Y2QIAgQmMCShIgQgdoq4tvMhnSYjA8VSV/3Xqt3H7FzbInfksyM6SK+fopowHQYDVR0OBBYEFNG4mBw/WGOTYyYUpqUFRKPNcwjJMB8GA1UdIwQYMBaAFJGgB/Nj5xBH+oZ0wTSktSXzbmZwMAoGCCqGSM49BAMCA0gAMEUCICoEa0Jbn/XCwUfSWzCDiEqkNMbuht3WqFBF4ILKZnkNAiEA41A9q4lb6FoOfmSOJ5unsoiszCIvKmLj7/K9LCsOjNpZAZYwggGSMIIBN6ADAgECAhQDCO0BDeoTaxZtBvgfQU/lmsxadjAKBggqhkjOPQQDAjAfMR0wGwYDVQQDDBRUZXN0IEFwcCBBdHRlc3QgUm9vdDAeFw0yNjA3MDgwOTMxMjlaFw0zNjA3MDUwOTMxMjlaMB0xGzAZBgNVBAMMElRlc3QgQXBwIEF0dGVzdCBDQTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKQ9+oGGTVqpKdjAVxaC4zytpQV2SvF+kio7dskCfyRO8wVkHq/gLlrNBlNeBqFD5P1fVXO8ELA4CSbe41bcayOjUzBRMA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYEFJGgB/Nj5xBH+oZ0wTSktSXzbmZwMB8GA1UdIwQYMBaAFKwjrNtM7VbLeUTo5qpC0lAUj0jEMAoGCCqGSM49BAMCA0kAMEYCIQDLkrTTH3RNInW9lqetWn1iO+C3NXaLLkPQUJ57YDlQSgIhAKDVcpBOiuBT+qs//8Jq9rysIeqajpWDvST91I/KkH5mZ3JlY2VpcHRMdGVzdC1yZWNlaXB0aGF1dGhEYXRhWKQ1cU4EsPOXfvKX68HBTBF7D4QAnRlP6QMDG/Zp0Di1DkAAAAAAYXBwYXR0ZXN0ZGV2ZWxvcAAgYo+ty5c80wkwys9J+l1eUsFkGS+GgijYdLfmbMFI0Q+lAQIDJiABIVggTqdLqMx87WZ50zPNGQyaB6QpltXDP5Ic6QXaTwxoj1AiWCCjv5KvenRhzJNUMNNDOnxGLjWzADIH3B5FD4JJl03xqw=='
