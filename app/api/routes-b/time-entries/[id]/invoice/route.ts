import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { generateInvoiceNumber } from '@/lib/utils'

type TimeEntryDelegate = {
  findFirst: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

function getTimeEntryDelegate(): TimeEntryDelegate {
  return (prisma as unknown as { timeEntry: TimeEntryDelegate }).timeEntry
}

async function getAuthenticatedUser(request: NextRequest) {
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const claims = await verifyAuthToken(authToken || '')

  if (!claims) {
    return null
  }

  return prisma.user.findUnique({
    where: { privyId: claims.userId },
    select: { id: true },
  })
}

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return '0'
  if (typeof (value as { toString?: () => string })?.toString === 'function') {
    return (value as { toString: () => string }).toString()
  }
  return String(value)
}

function computeInvoiceAmount(hours: unknown, rateUsdc: unknown): number | null {
  const h = Number.parseFloat(decimalToString(hours))
  const r = Number.parseFloat(decimalToString(rateUsdc))
  if (!Number.isFinite(h) || !Number.isFinite(r) || h <= 0 || r < 0) {
    return null
  }
  const amount = Math.round(h * r * 100) / 100
  if (amount <= 0) {
    return null
  }
  return amount
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseDueDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function serializeTimeEntry(entry: Record<string, unknown>) {
  return {
    id: entry.id,
    invoiceId: entry.invoiceId ?? null,
    description: entry.description,
    hours: decimalToString(entry.hours),
    rateUsdc: decimalToString(entry.rateUsdc),
    occurredOn: entry.occurredOn,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const payload = (body ?? {}) as Record<string, unknown>

  const clientEmail =
    typeof payload.clientEmail === 'string' ? payload.clientEmail.trim().toLowerCase() : ''
  if (!clientEmail || !isValidEmail(clientEmail)) {
    return NextResponse.json({ error: 'clientEmail is required and must be a valid email' }, { status: 400 })
  }

  const clientName =
    typeof payload.clientName === 'string' && payload.clientName.trim()
      ? payload.clientName.trim()
      : null

  const currency =
    typeof payload.currency === 'string' && /^[A-Z]{3}$/.test(payload.currency.trim().toUpperCase())
      ? payload.currency.trim().toUpperCase()
      : 'USD'

  const dueDate = parseDueDate(payload.dueDate)
  if (dueDate === null) {
    return NextResponse.json({ error: 'dueDate must be a valid date' }, { status: 400 })
  }

  const timeEntryDelegate = getTimeEntryDelegate()
  const entry = await timeEntryDelegate.findFirst({
    where: { id, userId: user.id },
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

  if (!entry) {
    return NextResponse.json({ error: 'Time entry not found' }, { status: 404 })
  }

  if (entry.status !== 'draft' || entry.invoiceId) {
    return NextResponse.json({ error: 'Time entry is already billed' }, { status: 409 })
  }

  const description =
    typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : String(entry.description)

  const amount = computeInvoiceAmount(entry.hours, entry.rateUsdc)
  if (amount === null) {
    return NextResponse.json({ error: 'Time entry has invalid hours or rate for invoicing' }, { status: 400 })
  }

  const invoiceNumber = generateInvoiceNumber()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`
  const paymentLink = `${baseUrl}/pay/${invoiceNumber}`

  const clientUser = await prisma.user.findUnique({
    where: { email: clientEmail },
    select: { id: true },
  })

  const { invoice, timeEntry } = await prisma.$transaction(async (tx) => {
    const createdInvoice = await tx.invoice.create({
      data: {
        userId: user.id,
        invoiceNumber,
        clientEmail,
        clientName,
        description,
        amount,
        currency,
        paymentLink,
        dueDate: dueDate ?? null,
        clientId: clientUser?.id ?? null,
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

    const updatedEntry = await tx.timeEntry.update({
      where: { id: entry.id as string },
      data: {
        invoiceId: createdInvoice.id,
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

    return { invoice: createdInvoice, timeEntry: updatedEntry }
  })

  return NextResponse.json(
    {
      invoice: {
        ...invoice,
        amount: Number(invoice.amount),
      },
      timeEntry: serializeTimeEntry(timeEntry as Record<string, unknown>),
    },
    { status: 201 },
  )
}
