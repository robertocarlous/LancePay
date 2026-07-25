import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const userFindUnique = vi.fn()
const withdrawalCreate = vi.fn()
const transactionMock = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops))

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    withdrawalTransaction: { create: withdrawalCreate },
    $transaction: transactionMock,
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const BASE_URL = 'http://localhost/api/routes-d/withdrawals/batch'

function makeRequest(body?: unknown, auth: string | null = 'Bearer token') {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest(BASE_URL, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const validItem = { amount: 50, anchorId: 'moneygram' }

describe('POST /api/routes-d/withdrawals/batch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when no auth token is provided', async () => {
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [validItem] }, null))
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    verifyAuthToken.mockResolvedValue(null)
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [validItem] }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user does not exist', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [validItem] }))
    expect(res.status).toBe(404)
  })

  it('returns 400 for malformed JSON body', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const req = new NextRequest(BASE_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: '{not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when withdrawals is missing or not an array', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/non-empty array/)
  })

  it('returns 400 when withdrawals is an empty array', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the batch exceeds the max size', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const items = Array.from({ length: 26 }, () => validItem)
    const res = await POST(makeRequest({ withdrawals: items }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/cannot contain more than/)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid amount on an item', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [{ amount: 0, anchorId: 'moneygram' }] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/amount/)
    expect(json.details).toEqual({ index: 0 })
  })

  it('returns 400 for an invalid anchorId on an item', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [{ amount: 20, anchorId: 'unknown-anchor' }] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/anchorId/)
  })

  it('returns 400 for an invalid withdrawType on an item', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(
      makeRequest({ withdrawals: [{ amount: 20, anchorId: 'moneygram', withdrawType: 'crypto' }] }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/withdrawType/)
  })

  it('does not create anything when one item in the batch is invalid', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(
      makeRequest({ withdrawals: [validItem, { amount: -5, anchorId: 'moneygram' }] }),
    )
    expect(res.status).toBe(400)
    expect(withdrawalCreate).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('creates a withdrawal transaction per item and returns 201 on success', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    withdrawalCreate.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: `wd_${args.data.anchorId}`,
        anchorId: args.data.anchorId,
        amount: args.data.amount,
        asset: args.data.asset,
        status: 'pending',
        withdrawType: args.data.withdrawType,
        createdAt: new Date('2025-01-01'),
      }),
    )

    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(
      makeRequest({ withdrawals: [validItem, { amount: 30, anchorId: 'yellowcard' }] }),
    )

    expect(res.status).toBe(201)
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(withdrawalCreate).toHaveBeenCalledTimes(2)
    expect(withdrawalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user_1', anchorId: 'moneygram', amount: 50, asset: 'USDC', status: 'pending' }),
      }),
    )

    const json = await res.json()
    expect(json.batchId).toMatch(/^batch_/)
    expect(json.count).toBe(2)
    expect(json.totalAmount).toBe(80)
    expect(json.withdrawals).toHaveLength(2)
  })

  it('returns 500 when the batch transaction fails', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    withdrawalCreate.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/routes-d/withdrawals/batch/route')
    const res = await POST(makeRequest({ withdrawals: [validItem] }))
    expect(res.status).toBe(500)
  })
})
