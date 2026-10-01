import { NextResponse } from 'next/server'
import { listQuestionnaires, createQuestionnaire, ensureSeeded } from '@/lib/db'
import { isAllowedOrigin, readJsonBody } from '@/lib/requestGuard'
import type { SectionData } from '@/lib/questions'
import { uid, isValidSlug, uniqueSlug, cloneQuestionnaireSections } from '@/lib/questions'

export async function GET() {
  try {
    await ensureSeeded()
    const questionnaires = await listQuestionnaires()
    return NextResponse.json({ questionnaires })
  } catch (error) {
    console.error('Failed to list questionnaires', error)
    return NextResponse.json({ error: 'Could not load questionnaires.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (!isAllowedOrigin(request)) {
      return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 })
    }

    const body = await readJsonBody(request)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })

    const data = body.value as Record<string, unknown>
    const nested = data.questionnaire as Record<string, unknown> | undefined
    const name = (typeof data.name === 'string' ? data.name.trim() : '') || (nested && typeof nested.name === 'string' ? nested.name.trim() : '')
    const rawSlug = (typeof data.slug === 'string' ? data.slug.trim() : '') || (nested && typeof nested.slug === 'string' ? nested.slug.trim() : '')
    const purpose = (typeof data.purpose === 'string' ? data.purpose.trim() : '') || (nested && typeof nested.purpose === 'string' ? nested.purpose.trim() : '')

    if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

    const existing = await listQuestionnaires()
    const taken = existing.map((q) => q.slug)
    const requestedSlug = rawSlug.replace(/^q\//, '')
    const slug = requestedSlug
      ? requestedSlug
      : uniqueSlug(name, taken)

    if (!isValidSlug(slug)) return NextResponse.json({ error: 'Use a valid slug.' }, { status: 400 })
    if (existing.some((q) => q.slug === slug || q.slug === 'q/' + slug)) {
      return NextResponse.json({ error: 'That slug is already in use.' }, { status: 400 })
    }

    let sections: SectionData[] = []
    const mode = typeof data.mode === 'string' ? data.mode : 'blank'
    const sourceId = typeof data.sourceId === 'string' ? data.sourceId : ''
    const templateId = typeof data.templateId === 'string' ? data.templateId : ''

    const jsonQ = data.questionnaire as Record<string, unknown> | undefined
    const jsonSections = Array.isArray(data.sections) ? data.sections : null
    const jsonQuestions = Array.isArray(data.questions) ? data.questions : null

    if (jsonSections && jsonQuestions) {
      const sectionMap: Record<string, SectionData> = {}
      for (const s of jsonSections) {
        const sec: SectionData = {
          id: String(s.id || uid('section')),
          title: String(s.title || 'Untitled'),
          order: Number(s.order) || 0,
          questions: [],
        }
        sectionMap[sec.id] = sec
      }
      for (const q of jsonQuestions) {
        const sid = String(q.sectionId || '')
        const sec = sectionMap[sid]
        if (!sec) continue
        sec.questions.push({
          id: String(q.id || uid('q')),
          sectionId: sid,
          type: String(q.type || 'short_text') as SectionData['questions'][0]['type'],
          question: String(q.question || ''),
          helpText: String(q.helpText ?? ''),
          placeholder: String(q.placeholder ?? ''),
          required: !!q.required,
          active: q.active !== false,
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          logic: q.logic && typeof q.logic === 'object' ? q.logic : undefined,
          role: typeof q.role === 'string' ? q.role as SectionData['questions'][0]['role'] : undefined,
          order: Number(q.order) || 0,
        })
      }
      sections = Object.values(sectionMap).sort((a, b) => a.order - b.order)
    } else {
      const source =
        mode === 'duplicate' ? existing.find((q) => q.id === sourceId) :
        mode === 'template' ? existing.find((q) => q.id === templateId) || existing.find((q) => q.isDefault) :
        mode === 'universal' ? existing.find((q) => q.isDefault) || existing[0] :
        null
      if (source) sections = cloneQuestionnaireSections(source.sections)
    }

    if (sections.length === 0 && (mode === 'blank' || !jsonSections)) {
      sections = [{ id: uid('section'), title: 'First section', order: 1, questions: [] }]
    }

    const questionnaire = await createQuestionnaire({
      name,
      slug: 'q/' + slug,
      purpose: purpose || (mode === 'duplicate' ? 'Duplicated questionnaire.' : 'Discovery questionnaire.'),
      status: data.isDefault === true ? 'live' : 'draft',
      isDefault: data.isDefault === true,
      theme: typeof data.theme === 'object' && data.theme ? data.theme as Partial<Record<string, unknown>> :
        typeof data.theme === 'string' ? { preset: data.theme } :
        nested && typeof nested.theme === 'string' ? { preset: nested.theme } :
        jsonQ && typeof jsonQ.theme === 'string' ? { preset: jsonQ.theme } :
        undefined,
      sections,
    })

    return NextResponse.json({ questionnaire })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Failed to create questionnaire', msg, error)
    return NextResponse.json({ error: `Could not create questionnaire: ${msg}` }, { status: 500 })
  }
}
