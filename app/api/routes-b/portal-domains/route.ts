import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { logger } from '@/lib/logger'

// ── GET,POST /api/routes-b/portal-domains — configure custom client portal domains ─

const MAX_DOMAINS_PER_USER = 5
const DOMAIN_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

async function getAuthenticatedUser(request: NextRequest) {
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return null

  const claims = await verifyAuthToken(authToken)
  if (!claims) return null

  return prisma.user.findUnique({
    where: { privyId: claims.userId },
    select: { id: true },
  })
}

function isValidDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain) && !/^\d+\.\d+\.\d+\.\d+$/.test(domain)
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const domains = await prisma.portalDomain.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        domain: true,
        status: true,
        verificationToken: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ domains })
  } catch (error) {
    logger.error({ err: error }, 'Portal domains GET error')
    return NextResponse.json({ error: 'Failed to get portal domains' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: { domain?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { domain } = body
    if (typeof domain !== 'string' || domain.trim().length === 0) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400 })
    }

    const normalizedDomain = domain.trim().toLowerCase()
    if (!isValidDomain(normalizedDomain)) {
      return NextResponse.json(
        { error: 'domain must be a valid hostname (e.g. "portal.example.com")' },
        { status: 400 },
      )
    }

    const existingCount = await prisma.portalDomain.count({ where: { userId: user.id } })
    if (existingCount >= MAX_DOMAINS_PER_USER) {
      return NextResponse.json(
        { error: `You cannot configure more than ${MAX_DOMAINS_PER_USER} portal domains` },
        { status: 400 },
      )
    }

    const existingDomain = await prisma.portalDomain.findUnique({
      where: { domain: normalizedDomain },
    })
    if (existingDomain) {
      return NextResponse.json({ error: 'This domain is already configured' }, { status: 409 })
    }

    const verificationToken = crypto.randomBytes(16).toString('hex')

    const created = await prisma.portalDomain.create({
      data: {
        userId: user.id,
        domain: normalizedDomain,
        status: 'pending',
        verificationToken,
      },
      select: {
        id: true,
        domain: true,
        status: true,
        verificationToken: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ domain: created }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'Portal domains POST error')
    return NextResponse.json({ error: 'Failed to add portal domain' }, { status: 500 })
  }
}
