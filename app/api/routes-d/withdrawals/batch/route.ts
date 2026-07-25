import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyAuthToken } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { nanoid } from 'nanoid'

// ── POST /api/routes-d/withdrawals/batch — submit a batch withdrawal ──
//
// Accepts a list of withdrawal requests and creates a WithdrawalTransaction
// for each one, scoped to the authenticated user. The whole batch is
// validated up front and created inside a single db transaction, so a
// single invalid or failed item never leaves a partial batch on record.

const VALID_ANCHORS = ['moneygram', 'yellowcard'] as const
const VALID_WITHDRAW_TYPES = ['bank_transfer', 'cash'] as const
const VALID_MEMO_TYPES = ['text', 'id', 'hash'] as const
const MAX_BATCH_SIZE = 25

interface BatchWithdrawalItem {
  amount: number
  anchorId: string
  asset?: string
  withdrawAddress?: string
  withdrawMemo?: string
  withdrawMemoType?: string
  withdrawType?: string
}

function validateItem(item: unknown, index: number): string | null {
  if (!item || typeof item !== 'object') {
    return `withdrawals[${index}] must be an object`
  }

  const { amount, anchorId, withdrawMemoType, withdrawType } = item as BatchWithdrawalItem

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return `withdrawals[${index}].amount must be a positive number`
  }
  if (
    typeof anchorId !== 'string' ||
    !VALID_ANCHORS.includes(anchorId as (typeof VALID_ANCHORS)[number])
  ) {
    return `withdrawals[${index}].anchorId must be one of: ${VALID_ANCHORS.join(', ')}`
  }
  if (
    withdrawMemoType !== undefined &&
    !VALID_MEMO_TYPES.includes(withdrawMemoType as (typeof VALID_MEMO_TYPES)[number])
  ) {
    return `withdrawals[${index}].withdrawMemoType must be one of: ${VALID_MEMO_TYPES.join(', ')}`
  }
  if (
    withdrawType !== undefined &&
    !VALID_WITHDRAW_TYPES.includes(withdrawType as (typeof VALID_WITHDRAW_TYPES)[number])
  ) {
    return `withdrawals[${index}].withdrawType must be one of: ${VALID_WITHDRAW_TYPES.join(', ')}`
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const authToken = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!authToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const claims = await verifyAuthToken(authToken)
    if (!claims) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const user = await prisma.user.findUnique({ where: { privyId: claims.userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    let body: { withdrawals?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { withdrawals } = body
    if (!Array.isArray(withdrawals) || withdrawals.length === 0) {
      return NextResponse.json({ error: 'withdrawals must be a non-empty array' }, { status: 400 })
    }
    if (withdrawals.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `withdrawals cannot contain more than ${MAX_BATCH_SIZE} items` },
        { status: 400 },
      )
    }

    for (let i = 0; i < withdrawals.length; i++) {
      const itemError = validateItem(withdrawals[i], i)
      if (itemError) {
        return NextResponse.json({ error: itemError, details: { index: i } }, { status: 400 })
      }
    }

    const items = withdrawals as BatchWithdrawalItem[]
    const batchId = `batch_${nanoid(12)}`

    const created = await prisma.$transaction(
      items.map((item) =>
        prisma.withdrawalTransaction.create({
          data: {
            userId: user.id,
            anchorId: item.anchorId,
            amount: item.amount,
            asset: item.asset ?? 'USDC',
            withdrawAddress: item.withdrawAddress,
            withdrawMemo: item.withdrawMemo,
            withdrawMemoType: item.withdrawMemoType,
            withdrawType: item.withdrawType ?? 'bank_transfer',
            status: 'pending',
          },
          select: {
            id: true,
            anchorId: true,
            amount: true,
            asset: true,
            status: true,
            withdrawType: true,
            createdAt: true,
          },
        }),
      ),
    )

    const createdWithdrawals = created.map((w) => ({ ...w, amount: Number(w.amount) }))
    const totalAmount = createdWithdrawals.reduce((sum, w) => sum + w.amount, 0)

    return NextResponse.json(
      {
        batchId,
        count: createdWithdrawals.length,
        totalAmount,
        withdrawals: createdWithdrawals,
      },
      { status: 201 },
    )
  } catch (error) {
    logger.error({ err: error }, 'Batch withdrawal error')
    return NextResponse.json({ error: 'Failed to submit batch withdrawal' }, { status: 500 })
  }
}
