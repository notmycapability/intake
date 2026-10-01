import { notFound } from 'next/navigation'
import { getQuestionnaireBySlug, ensureSeeded } from '@/lib/db'
import { ClientQuestionnaire } from '@/components/ClientQuestionnaire'

export const dynamic = 'force-dynamic'

export default async function QuestionnairePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  try {
    await ensureSeeded()
    const questionnaire = await getQuestionnaireBySlug('q/' + slug)
    if (!questionnaire) return notFound()
    if (questionnaire.status === 'closed') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center">
          <div className="max-w-[520px]">
            <h1 className="text-2xl font-semibold tracking-tight">This questionnaire is closed.</h1>
            <p className="mt-3 text-sm text-muted">It is no longer accepting new responses.</p>
          </div>
        </div>
      )
    }
    if (questionnaire.status !== 'live') return notFound()
    return <ClientQuestionnaire questionnaire={questionnaire} />
  } catch (error) {
    console.error('Failed to load questionnaire', error)
    return notFound()
  }
}
