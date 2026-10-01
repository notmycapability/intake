import { NextResponse } from 'next/server'
import { getResponse, updateResponseStatus, deleteResponse, addResponseNote } from '@/lib/db'
import { isAllowedOrigin, readJsonBody } from '@/lib/requestGuard'
import { uid, type ResponseData } from '@/lib/questions'

const RESPONSE_STATUSES: ResponseData['status'][] = ['new', 'reviewed', 'incomplete', 'archived', 'trash']

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const response = await getResponse(id)
    if (!response) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ response })
  } catch (error) {
    console.error('Failed to get response', error)
    return NextResponse.json({ error: 'Could not load response.' }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isAllowedOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
    const { id } = await params
    const body = await readJsonBody(request)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
    const data = body.value as Record<string, unknown>

    if (typeof data.note === 'string' && data.note.trim()) {
      const notes = await addResponseNote(id, {
        id: uid('note'),
        author: 'Admin',
        time: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        body: data.note.trim(),
      })
      if (!notes) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
      return NextResponse.json({ ok: true, notes })
    }

    const status = data.status as ResponseData['status']
    if (!RESPONSE_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid response status.' }, { status: 400 })
    }
    await updateResponseStatus(id, status)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to update response', error)
    return NextResponse.json({ error: 'Could not update response.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isAllowedOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
    const { id } = await params
    const existing = await getResponse(id)
    if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    await deleteResponse(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to delete response', error)
    return NextResponse.json({ error: 'Could not delete response.' }, { status: 500 })
  }
}
