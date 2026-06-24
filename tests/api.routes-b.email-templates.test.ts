import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const userFindUnique = vi.fn()
const emailTemplateFindMany = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    emailTemplate: { findMany: emailTemplateFindMany },
  },
}))

const BASE_URL = 'http://localhost/api/routes-b/email-templates'

function makeRequest(
  headers: Record<string, string> = { authorization: 'Bearer token' },
  searchParams?: Record<string, string>,
) {
  const url = new URL(BASE_URL)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value)
    }
  }
  return new NextRequest(url.toString(), { headers })
}

describe('GET /api/routes-b/email-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no auth token is provided', async () => {
    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest({}))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when the auth token is invalid', async () => {
    verifyAuthToken.mockResolvedValue(null)

    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the user is not found', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue(null)

    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'User not found' })
    expect(emailTemplateFindMany).not.toHaveBeenCalled()
  })

  it('returns 400 when templateType query param is invalid', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })

    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest({}, { templateType: 'invalid' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'templateType must be one of: invoice, reminder, payment, dispute, escrow, message, custom',
    })
    expect(emailTemplateFindMany).not.toHaveBeenCalled()
  })

  it('returns empty templates array when user has no templates', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    emailTemplateFindMany.mockResolvedValue([])

    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.templates).toEqual([])
  })

  it('returns email templates for the authenticated user', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    emailTemplateFindMany.mockResolvedValue([
      {
        id: 'tpl_1',
        name: 'Invoice Reminder',
        subject: 'Payment due for {{invoiceNumber}}',
        body: '<p>Hi {{clientName}}, your invoice is due.</p>',
        templateType: 'invoice',
        isDefault: true,
        createdAt: new Date('2026-06-20T00:00:00Z'),
        updatedAt: new Date('2026-06-20T00:00:00Z'),
      },
    ])

    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.templates).toHaveLength(1)
    expect(body.templates[0].name).toBe('Invoice Reminder')
    expect(emailTemplateFindMany).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        subject: true,
        body: true,
        templateType: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  })

  it('filters by templateType when query param is provided', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    emailTemplateFindMany.mockResolvedValue([])

    const { GET } = await import('@/app/api/routes-b/email-templates/route')
    const response = await GET(makeRequest({}, { templateType: 'reminder' }))

    expect(response.status).toBe(200)
    expect(emailTemplateFindMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', templateType: 'reminder' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        subject: true,
        body: true,
        templateType: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  })
})
