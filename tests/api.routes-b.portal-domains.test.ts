import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const userFindUnique = vi.fn()
const domainFindMany = vi.fn()
const domainCount = vi.fn()
const domainFindUnique = vi.fn()
const domainCreate = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    portalDomain: {
      findMany: domainFindMany,
      count: domainCount,
      findUnique: domainFindUnique,
      create: domainCreate,
    },
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const BASE_URL = 'http://localhost/api/routes-b/portal-domains'

function makeRequest(method: string, body?: unknown, auth: string | null = 'Bearer token') {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest(BASE_URL, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/routes-b/portal-domains', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when no auth token is provided', async () => {
    const { GET } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await GET(makeRequest('GET', undefined, null))
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    verifyAuthToken.mockResolvedValue(null)
    const { GET } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(401)
  })

  it('returns an empty list when the user has no domains', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainFindMany.mockResolvedValue([])
    const { GET } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ domains: [] })
  })

  it('returns domains scoped to the authenticated user', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainFindMany.mockResolvedValue([
      { id: 'd1', domain: 'portal.example.com', status: 'pending', verificationToken: 'tok', verifiedAt: null },
    ])
    const { GET } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    expect(domainFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1' } }),
    )
    const json = await res.json()
    expect(json.domains).toHaveLength(1)
  })

  it('returns 500 when the database lookup fails', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainFindMany.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/routes-b/portal-domains', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 for unauthenticated requests', async () => {
    verifyAuthToken.mockResolvedValue(null)
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: 'portal.example.com' }))
    expect(res.status).toBe(401)
    expect(domainCreate).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON body', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const req = new NextRequest(BASE_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: '{not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when domain is missing', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', {}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/domain is required/)
  })

  it('returns 400 for an invalid domain format', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: 'not a domain' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/valid hostname/)
  })

  it('returns 400 for a raw IP address', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: '192.168.1.1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the user already has the max number of domains', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainCount.mockResolvedValue(5)
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: 'portal.example.com' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/cannot configure more than/)
    expect(domainCreate).not.toHaveBeenCalled()
  })

  it('returns 409 when the domain is already taken', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainCount.mockResolvedValue(0)
    domainFindUnique.mockResolvedValue({ id: 'd1', domain: 'portal.example.com' })
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: 'portal.example.com' }))
    expect(res.status).toBe(409)
    expect(domainCreate).not.toHaveBeenCalled()
  })

  it('creates a domain scoped to the authenticated user on success', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainCount.mockResolvedValue(0)
    domainFindUnique.mockResolvedValue(null)
    const created = {
      id: 'd1',
      domain: 'portal.example.com',
      status: 'pending',
      verificationToken: 'abc123',
      verifiedAt: null,
    }
    domainCreate.mockResolvedValue(created)

    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: 'Portal.Example.com' }))

    expect(res.status).toBe(201)
    expect(domainCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          domain: 'portal.example.com',
          status: 'pending',
        }),
      }),
    )
    await expect(res.json()).resolves.toEqual({ domain: created })
  })

  it('returns 500 when the create fails', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    domainCount.mockResolvedValue(0)
    domainFindUnique.mockResolvedValue(null)
    domainCreate.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/routes-b/portal-domains/route')
    const res = await POST(makeRequest('POST', { domain: 'portal.example.com' }))
    expect(res.status).toBe(500)
  })
})
