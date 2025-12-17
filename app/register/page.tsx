'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'CLIENT' | 'PRO'>('CLIENT')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role,
          firstName: role === 'CLIENT' ? firstName : undefined,
          lastName: role === 'CLIENT' ? lastName : undefined,
          businessName: role === 'PRO' ? businessName : undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      // Redirect based on role
      if (data.user.role === 'CLIENT') {
        router.push('/client')
      } else if (data.user.role === 'PRO') {
        router.push('/pro')
      } else {
        router.push('/') // fallback, should never hit
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Register</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label>
          Role
          <select value={role} onChange={e => setRole(e.target.value as 'CLIENT' | 'PRO')}>
            <option value="CLIENT">Client</option>
            <option value="PRO">Professional</option>
          </select>
        </label>

        <label>
          Email
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
        </label>

        <label>
          Password
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" required />
        </label>

        {role === 'CLIENT' && (
          <>
            <label>
              First name
              <input value={firstName} onChange={e => setFirstName(e.target.value)} />
            </label>
            <label>
              Last name
              <input value={lastName} onChange={e => setLastName(e.target.value)} />
            </label>
          </>
        )}

        {role === 'PRO' && (
          <label>
            Business name
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} />
          </label>
        )}

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Register'}
        </button>
      </form>
    </div>
  )
}
