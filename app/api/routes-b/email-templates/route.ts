import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'

const VALID_TEMPLATE_TYPES = [
  'invoice',
  'reminder',
  'payment',
  'dispute',
  'escrow',
  'message',
  'custom',
] as const

type EmailTemplateDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>
}

function getEmailTemplateDelegate(): EmailTemplateDelegate {
  return (prisma as unknown as { emailTemplate: EmailTemplateDelegate }).emailTemplate
}

export async function GET(request: NextRequest) {
  try {
    const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
    const claims = await verifyAuthToken(authToken || '')
    if (!claims) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const templateType = searchParams.get('templateType')?.trim() || undefined

    if (
      templateType &&
      !VALID_TEMPLATE_TYPES.includes(templateType as (typeof VALID_TEMPLATE_TYPES)[number])
    ) {
      return NextResponse.json(
        {
          error:
            'templateType must be one of: invoice, reminder, payment, dispute, escrow, message, custom',
        },
        { status: 400 },
      )
    }

    const where: Record<string, unknown> = { userId: user.id }
    if (templateType) {
      where.templateType = templateType
    }

    const delegate = getEmailTemplateDelegate()
    const templates = await delegate.findMany({
      where,
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

    return NextResponse.json({ templates })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
