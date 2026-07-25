import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const findUnique = vi.fn()
const brandingFindUnique = vi.fn()
const brandingUpsert = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique },
    brandingSettings: {
      findUnique: brandingFindUnique,
      upsert: brandingUpsert,
    },
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const BASE_URL = 'http://localhost/api/routes-b/portal-branding'

function makeRequest(method: string, body?: unknown, withAuth = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (withAuth) headers.authorization = 'Bearer token'
  return new NextRequest(BASE_URL, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/routes-b/portal-branding', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when no auth token is provided', async () => {
    const { GET } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await GET(makeRequest('GET', undefined, false))
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    verifyAuthToken.mockResolvedValue(null)
    const { GET } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(401)
  })

  it('returns null branding when none exists yet', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingFindUnique.mockResolvedValue(null)
    const { GET } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ branding: null })
    expect(brandingFindUnique).toHaveBeenCalledWith({ where: { userId: 'user_1' } })
  })

  it('returns existing branding settings scoped to the authenticated user', async () => {
    const branding = {
      id: 'b1',
      userId: 'user_1',
      logoUrl: 'https://example.com/logo.png',
      primaryColor: '#6366f1',
      footerText: 'Thanks for your business!',
      signatureUrl: null,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    }
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingFindUnique.mockResolvedValue(branding)
    const { GET } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.branding.primaryColor).toBe('#6366f1')
  })

  it('returns 500 when the database lookup fails', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingFindUnique.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/routes-b/portal-branding', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 for unauthenticated requests', async () => {
    verifyAuthToken.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', {}))
    expect(res.status).toBe(401)
    expect(brandingUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON body', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const req = new NextRequest(BASE_URL, {
      method: 'PATCH',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: '{not-json',
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid hex primaryColor', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', { primaryColor: 'red' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/primaryColor/)
    expect(brandingUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-https logoUrl', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', { logoUrl: 'http://example.com/logo.png' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/logoUrl/)
  })

  it('returns 400 for footerText exceeding max length', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', { footerText: 'x'.repeat(201) }))
    expect(res.status).toBe(400)
  })

  it('upserts branding scoped to the authenticated user with valid data', async () => {
    const branding = { id: 'b1', userId: 'user_1', primaryColor: '#6366f1', footerText: 'Thanks!' }
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingUpsert.mockResolvedValue(branding)
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', { primaryColor: '#6366f1', footerText: 'Thanks!' }))
    expect(res.status).toBe(200)
    expect(brandingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1' },
        update: expect.objectContaining({ primaryColor: '#6366f1', footerText: 'Thanks!' }),
        create: expect.objectContaining({ userId: 'user_1', primaryColor: '#6366f1', footerText: 'Thanks!' }),
      }),
    )
    await expect(res.json()).resolves.toEqual({ branding })
  })

  it('allows signatureUrl: null to clear the field', async () => {
    const branding = { id: 'b1', userId: 'user_1', signatureUrl: null }
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingUpsert.mockResolvedValue(branding)
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', { signatureUrl: null }))
    expect(res.status).toBe(200)
    expect(brandingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ signatureUrl: null }) }),
    )
  })

  it('returns 200 with unchanged branding on empty body', async () => {
    const branding = { id: 'b1', userId: 'user_1', primaryColor: '#000000' }
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingUpsert.mockResolvedValue(branding)
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', {}))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ branding })
  })

  it('returns 500 when the upsert fails', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    findUnique.mockResolvedValue({ id: 'user_1' })
    brandingUpsert.mockRejectedValue(new Error('db down'))
    const { PATCH } = await import('@/app/api/routes-b/portal-branding/route')
    const res = await PATCH(makeRequest('PATCH', { primaryColor: '#6366f1' }))
    expect(res.status).toBe(500)
  })
})
