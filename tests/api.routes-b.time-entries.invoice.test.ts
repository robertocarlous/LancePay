import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const userFindUnique = vi.fn()
const timeEntryFindFirst = vi.fn()
const timeEntryUpdate = vi.fn()
const invoiceCreate = vi.fn()
const transactionFn = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/utils', () => ({
  generateInvoiceNumber: vi.fn(() => 'INV-TEST-001'),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    timeEntry: {
      findFirst: timeEntryFindFirst,
      update: timeEntryUpdate,
    },
    invoice: { create: invoiceCreate },
    $transaction: transactionFn,
  },
}))

const BASE_URL = 'http://localhost/api/routes-b/time-entries/te_1/invoice'

function makePostRequest(
  body: Record<string, unknown> = { clientEmail: 'client@example.com' },
  headers: Record<string, string> = { authorization: 'Bearer token', 'content-type': 'application/json' },
) {
  return new NextRequest(BASE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const draftEntry = {
  id: 'te_1',
  description: 'Design review',
  hours: { toString: () => '2.50' },
  rateUsdc: { toString: () => '75.000000' },
  occurredOn: new Date('2026-06-20T00:00:00Z'),
  status: 'draft',
  invoiceId: null,
  createdAt: new Date('2026-06-20T10:00:00Z'),
  updatedAt: new Date('2026-06-20T10:00:00Z'),
}

describe('POST /api/routes-b/time-entries/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
    transactionFn.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        invoice: { create: invoiceCreate },
        timeEntry: { update: timeEntryUpdate },
      }),
    )
  })

  it('returns 401 when the user is not authenticated', async () => {
    verifyAuthToken.mockResolvedValue(null)

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(makePostRequest(), { params: Promise.resolve({ id: 'te_1' }) })

    expect(response.status).toBe(401)
    expect(timeEntryFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 when clientEmail is missing', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(makePostRequest({}), { params: Promise.resolve({ id: 'te_1' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'clientEmail is required and must be a valid email',
    })
    expect(timeEntryFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 when clientEmail is invalid', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(
      makePostRequest({ clientEmail: 'not-an-email' }),
      { params: Promise.resolve({ id: 'te_1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'clientEmail is required and must be a valid email',
    })
  })

  it('returns 404 when the time entry is not found', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    timeEntryFindFirst.mockResolvedValue(null)

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(makePostRequest(), { params: Promise.resolve({ id: 'te_missing' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Time entry not found' })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('returns 409 when the time entry is already billed', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    timeEntryFindFirst.mockResolvedValue({
      ...draftEntry,
      status: 'billed',
      invoiceId: 'inv_1',
    })

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(makePostRequest(), { params: Promise.resolve({ id: 'te_1' }) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'Time entry is already billed' })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('returns 400 when dueDate is invalid', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    timeEntryFindFirst.mockResolvedValue(draftEntry)

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(
      makePostRequest({ clientEmail: 'client@example.com', dueDate: 'not-a-date' }),
      { params: Promise.resolve({ id: 'te_1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'dueDate must be a valid date' })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('creates an invoice draft and marks the time entry as billed', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique
      .mockResolvedValueOnce({ id: 'user_1' })
      .mockResolvedValueOnce(null)
    timeEntryFindFirst.mockResolvedValue(draftEntry)
    invoiceCreate.mockResolvedValue({
      id: 'inv_1',
      invoiceNumber: 'INV-TEST-001',
      clientEmail: 'client@example.com',
      clientName: 'Bob Client',
      description: 'Design review',
      amount: 187.5,
      currency: 'USD',
      status: 'pending',
      paymentLink: 'https://example.com/pay/INV-TEST-001',
      dueDate: null,
      createdAt: new Date('2026-06-24T00:00:00Z'),
    })
    timeEntryUpdate.mockResolvedValue({
      ...draftEntry,
      invoiceId: 'inv_1',
      status: 'billed',
      updatedAt: new Date('2026-06-24T00:00:00Z'),
    })

    const { POST } = await import('@/app/api/routes-b/time-entries/[id]/invoice/route')
    const response = await POST(
      makePostRequest({
        clientEmail: 'client@example.com',
        clientName: 'Bob Client',
      }),
      { params: Promise.resolve({ id: 'te_1' }) },
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.invoice).toMatchObject({
      id: 'inv_1',
      invoiceNumber: 'INV-TEST-001',
      amount: 187.5,
      status: 'pending',
      paymentLink: 'https://example.com/pay/INV-TEST-001',
    })
    expect(body.timeEntry).toMatchObject({
      id: 'te_1',
      invoiceId: 'inv_1',
      status: 'billed',
      hours: '2.50',
      rateUsdc: '75.000000',
    })

    expect(timeEntryFindFirst).toHaveBeenCalledWith({
      where: { id: 'te_1', userId: 'user_1' },
      select: {
        id: true,
        description: true,
        hours: true,
        rateUsdc: true,
        occurredOn: true,
        status: true,
        invoiceId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    expect(invoiceCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        invoiceNumber: 'INV-TEST-001',
        clientEmail: 'client@example.com',
        clientName: 'Bob Client',
        description: 'Design review',
        amount: 187.5,
        currency: 'USD',
        paymentLink: 'https://example.com/pay/INV-TEST-001',
        dueDate: null,
        clientId: null,
      },
      select: {
        id: true,
        invoiceNumber: true,
        clientEmail: true,
        clientName: true,
        description: true,
        amount: true,
        currency: true,
        status: true,
        paymentLink: true,
        dueDate: true,
        createdAt: true,
      },
    })

    expect(timeEntryUpdate).toHaveBeenCalledWith({
      where: { id: 'te_1' },
      data: {
        invoiceId: 'inv_1',
        status: 'billed',
      },
      select: {
        id: true,
        invoiceId: true,
        description: true,
        hours: true,
        rateUsdc: true,
        occurredOn: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  })
})
