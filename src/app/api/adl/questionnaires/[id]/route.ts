import { NextResponse } from 'next/server'
import { getQuestionnaire, updateQuestionnaire, deleteQuestionnaire } from '@/lib/db'
import { isAllowedOrigin, readJsonBody } from '@/lib/requestGuard'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const questionnaire = await getQuestionnaire(id)
    if (!questionnaire) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ questionnaire })
  } catch (error) {
    console.error('Failed to get questionnaire', error)
    return NextResponse.json({ error: 'Could not load questionnaire.' }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isAllowedOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
    const { id } = await params
    const body = await readJsonBody(request)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
    const data = body.value as Record<string, unknown>
    const updated = await updateQuestionnaire(id, data as Parameters<typeof updateQuestionnaire>[1])
    if (!updated) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ questionnaire: updated })
  } catch (error) {
    console.error('Failed to update questionnaire', error)
    return NextResponse.json({ error: 'Could not update questionnaire.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isAllowedOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
    const { id } = await params
    const q = await getQuestionnaire(id)
    if (!q) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    if (q.isDefault && q.status !== 'trash') {
      return NextResponse.json({ error: 'Move the homepage form to trash before deleting it.' }, { status: 400 })
    }
    await deleteQuestionnaire(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to delete questionnaire', error)
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 })
  }
}
