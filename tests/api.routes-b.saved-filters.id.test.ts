import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyAuthToken = vi.fn()
const userFindUnique = vi.fn()
const savedFilterFindFirst = vi.fn()
const savedFilterDelete = vi.fn()

vi.mock('@/lib/auth', () => ({ verifyAuthToken }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    savedFilter: {
      findFirst: savedFilterFindFirst,
      delete: savedFilterDelete,
    },
  },
}))

function deleteRequest(
  id: string,
  headers: Record<string, string> = { authorization: 'Bearer token' },
) {
  return new NextRequest(`http://localhost/api/routes-b/saved-filters/${id}`, {
    method: 'DELETE',
    headers,
  })
}

describe('DELETE /api/routes-b/saved-filters/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no auth token is provided', async () => {
    const { DELETE } = await import('@/app/api/routes-b/saved-filters/[id]/route')
    const response = await DELETE(deleteRequest('filter_1', {}), {
      params: Promise.resolve({ id: 'filter_1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when the auth token is invalid', async () => {
    verifyAuthToken.mockResolvedValue(null)

    const { DELETE } = await import('@/app/api/routes-b/saved-filters/[id]/route')
    const response = await DELETE(deleteRequest('filter_1'), {
      params: Promise.resolve({ id: 'filter_1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the user is not found', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue(null)

    const { DELETE } = await import('@/app/api/routes-b/saved-filters/[id]/route')
    const response = await DELETE(deleteRequest('filter_1'), {
      params: Promise.resolve({ id: 'filter_1' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'User not found' })
    expect(savedFilterFindFirst).not.toHaveBeenCalled()
  })

  it('returns 404 when the saved filter is not found', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    savedFilterFindFirst.mockResolvedValue(null)

    const { DELETE } = await import('@/app/api/routes-b/saved-filters/[id]/route')
    const response = await DELETE(deleteRequest('filter_missing'), {
      params: Promise.resolve({ id: 'filter_missing' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Saved filter not found' })
    expect(savedFilterDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when the saved filter belongs to another user', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    savedFilterFindFirst.mockResolvedValue(null)

    const { DELETE } = await import('@/app/api/routes-b/saved-filters/[id]/route')
    const response = await DELETE(deleteRequest('filter_other'), {
      params: Promise.resolve({ id: 'filter_other' }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Saved filter not found' })
    expect(savedFilterFindFirst).toHaveBeenCalledWith({
      where: { id: 'filter_other', userId: 'user_1' },
      select: { id: true },
    })
    expect(savedFilterDelete).not.toHaveBeenCalled()
  })

  it('deletes the saved filter and returns 204', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'privy_1' })
    userFindUnique.mockResolvedValue({ id: 'user_1' })
    savedFilterFindFirst.mockResolvedValue({ id: 'filter_1' })
    savedFilterDelete.mockResolvedValue({ id: 'filter_1' })

    const { DELETE } = await import('@/app/api/routes-b/saved-filters/[id]/route')
    const response = await DELETE(deleteRequest('filter_1'), {
      params: Promise.resolve({ id: 'filter_1' }),
    })

    expect(response.status).toBe(204)
    expect(savedFilterFindFirst).toHaveBeenCalledWith({
      where: { id: 'filter_1', userId: 'user_1' },
      select: { id: true },
    })
    expect(savedFilterDelete).toHaveBeenCalledWith({ where: { id: 'filter_1' } })
  })
})
