import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { logger } from '@/lib/logger'

// ── GET,PATCH /api/routes-b/portal-branding — customize client portal branding ─

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

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const branding = await prisma.brandingSettings.findUnique({
      where: { userId: user.id },
    })

    return NextResponse.json({ branding: branding ?? null })
  } catch (error) {
    logger.error({ err: error }, 'Portal branding GET error')
    return NextResponse.json({ error: 'Failed to get portal branding settings' }, { status: 500 })
  }
}

function isValidHex(c: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(c)
}

function isValidHttpsUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (body.logoUrl !== undefined && body.logoUrl !== null) {
      if (typeof body.logoUrl !== 'string' || body.logoUrl.length > 512 || !isValidHttpsUrl(body.logoUrl)) {
        return NextResponse.json({ error: 'logoUrl must be a valid https:// URL (max 512 chars)' }, { status: 400 })
      }
    }

    if (body.primaryColor !== undefined) {
      if (typeof body.primaryColor !== 'string' || !isValidHex(body.primaryColor)) {
        return NextResponse.json({ error: 'primaryColor must be a valid 6-digit hex color (e.g. "#a1b2c3")' }, { status: 400 })
      }
    }

    if (body.footerText !== undefined && body.footerText !== null) {
      if (typeof body.footerText !== 'string' || body.footerText.length > 200) {
        return NextResponse.json({ error: 'footerText must be a string of at most 200 characters' }, { status: 400 })
      }
    }

    if (body.signatureUrl !== undefined && body.signatureUrl !== null) {
      if (typeof body.signatureUrl !== 'string' || body.signatureUrl.length > 512 || !isValidHttpsUrl(body.signatureUrl)) {
        return NextResponse.json({ error: 'signatureUrl must be a valid https:// URL (max 512 chars)' }, { status: 400 })
      }
    }

    const updateData: Record<string, unknown> = {}
    const createData: Record<string, unknown> = { userId: user.id }

    if (body.logoUrl !== undefined) {
      updateData.logoUrl = body.logoUrl
      createData.logoUrl = body.logoUrl
    }
    if (body.primaryColor !== undefined) {
      updateData.primaryColor = body.primaryColor
      createData.primaryColor = body.primaryColor
    }
    if (body.footerText !== undefined) {
      updateData.footerText = body.footerText
      createData.footerText = body.footerText
    }
    if (body.signatureUrl !== undefined) {
      updateData.signatureUrl = body.signatureUrl
      createData.signatureUrl = body.signatureUrl
    }

    const branding = await prisma.brandingSettings.upsert({
      where: { userId: user.id },
      update: updateData,
      create: createData as Parameters<typeof prisma.brandingSettings.create>[0]['data'],
    })

    return NextResponse.json({ branding })
  } catch (error) {
    logger.error({ err: error }, 'Portal branding PATCH error')
    return NextResponse.json({ error: 'Failed to update portal branding settings' }, { status: 500 })
  }
}
