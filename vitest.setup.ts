process.env.JWT_SECRET ??= 'test-jwt-secret-for-local-vitest-only'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
import '@testing-library/jest-dom/vitest'