'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppsrowLogo } from '@/components/AppsrowLogo'
import { Icon, initials, statusClass } from '@/components/admin/icons'
import {
  type QuestionnaireData,
  type SectionData,
  type QuestionData,
  type ResponseData,
  type WorkspaceSettings,
  type ThemePreset,
  type ShowOperator,
  type QuestionRole,
  SUPPORTED_TYPES,
  OPERATORS,
  TYPE_LABELS,
  ROLE_LABELS,
  QUESTION_ROLES,
  isChoiceType,
  qCount,
  logicCount,
} from '@/lib/questions'
import { exportResponses } from '@/lib/exportResponses'
import { isPlaceholderValue } from '@/lib/contactFields'

type Page = 'overview' | 'questionnaires' | 'builder' | 'responses' | 'templates' | 'settings' | 'developer'
type CreateMode = 'blank' | 'template' | 'duplicate' | 'import'

const PAGE_TITLES: Record<Page, string> = {
  overview: 'Overview',
  questionnaires: 'Questionnaires',
  builder: 'Builder',
  responses: 'Responses',
  templates: 'Templates',
  settings: 'Settings',
  developer: 'Developer',
}

export function AdminWorkspace({
  initialQuestionnaires,
  initialResponses,
  initialWorkspace,
}: {
  initialQuestionnaires: QuestionnaireData[]
  initialResponses: ResponseData[]
  initialWorkspace: WorkspaceSettings
}) {
  const router = useRouter()
  const [questionnaires, setQuestionnaires] = useState(initialQuestionnaires)
  const [responses, setResponses] = useState(initialResponses)
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [page, setPage] = useState<Page>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [currentQId, setCurrentQId] = useState(questionnaires[0]?.id || '')
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null)
  const [currentResponseId, setCurrentResponseId] = useState<string | null>(null)
  const [questionSearch, setQuestionSearch] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewPick, setPreviewPick] = useState('')
  const [responseFilter, setResponseFilter] = useState('all')
  const [responseSearch, setResponseSearch] = useState('')
  const [responseQuestionnaire, setResponseQuestionnaire] = useState('all')
  const [responseProjectType, setResponseProjectType] = useState('all')
  const [responseDate, setResponseDate] = useState('all')
  const [selectedResponses, setSelectedResponses] = useState<string[]>([])
  const [qSearch, setQSearch] = useState('')
  const [qStatusFilter, setQStatusFilter] = useState('all')
  const [toast, setToast] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [settingsSection, setSettingsSection] = useState('general')
  const [audit, setAudit] = useState<{ title: string; time: string }[]>([])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }
  function showError(err: unknown) {
    showToast(err instanceof Error ? err.message : 'Something went wrong.')
  }
  function logAction(title: string) {
    setAudit((prev) => [{ title, time: 'Just now' }, ...prev].slice(0, 12))
  }

  const currentQ = useMemo(() => questionnaires.find((q) => q.id === currentQId), [questionnaires, currentQId])
  const currentResponse = useMemo(() => responses.find((r) => r.id === currentResponseId), [responses, currentResponseId])
  const defaultQ = useMemo(() => questionnaires.find((q) => q.isDefault && q.status !== 'trash') || questionnaires.find((q) => q.status === 'live'), [questionnaires])
  const newCount = responses.filter((r) => r.status === 'new').length

  function goPage(next: Page) {
    setPage(next)
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function publicUrl(q: QuestionnaireData) {
    const base = workspace.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    return 'https://' + base + '/' + q.slug.replace(/^\//, '')
  }

  async function copyText(text: string, msg: string) {
    try { await navigator.clipboard.writeText(text); showToast(msg) } catch { showToast(text) }
  }

  async function handleLogout() {
    try {
      await fetch('/api/adl/logout', { method: 'POST' })
      router.refresh()
    } catch (err) { showError(err) }
  }

  function openBuilder(id: string) {
    setCurrentQId(id)
    const q = questionnaires.find((x) => x.id === id)
    setCurrentQuestionId(q?.sections.flatMap((s) => s.questions)[0]?.id || null)
    setQuestionSearch('')
    setPreviewPick('')
    goPage('builder')
  }

  function openShare(q: QuestionnaireData) {
    setCurrentQId(q.id)
    setShowShareModal(true)
  }

  async function patchQuestionnaire(id: string, body: Record<string, unknown>, message?: string) {
    const res = await fetch(`/api/adl/questionnaires/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) { showToast('Could not update questionnaire'); return null }
    const data = await res.json() as { questionnaire: QuestionnaireData }
    setQuestionnaires((prev) => prev.map((x) => {
      if (x.id === id) return data.questionnaire
      if (body.isDefault === true) return { ...x, isDefault: false }
      return x
    }))
    if (message) showToast(message)
    return data.questionnaire
  }

  async function setQStatus(q: QuestionnaireData, status: QuestionnaireData['status']) {
    const labels: Record<string, string> = { live: 'Published', draft: 'Moved to draft', closed: 'Closed', archived: 'Archived', trash: 'Moved to trash' }
    await patchQuestionnaire(q.id, { status }, labels[status] || 'Updated')
    logAction(`${q.name} → ${status}`)
  }

  async function duplicateQuestionnaire(q: QuestionnaireData) {
    try {
      const res = await fetch('/api/adl/questionnaires', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${q.name} copy`, purpose: q.purpose, mode: 'duplicate', sourceId: q.id }),
      })
      const data = await res.json() as { questionnaire?: QuestionnaireData; error?: string }
      if (!res.ok || !data.questionnaire) { showToast(data.error || 'Could not duplicate'); return }
      setQuestionnaires((prev) => [...prev, data.questionnaire!])
      showToast('Questionnaire duplicated')
      logAction(`Duplicated ${q.name}`)
      openBuilder(data.questionnaire.id)
    } catch (err) { showError(err) }
  }

  async function makeHomepageForm(q: QuestionnaireData) {
    await patchQuestionnaire(q.id, { isDefault: true, status: 'live' }, 'This form now opens on the public homepage')
  }

  async function handleDeleteQuestionnaire(q: QuestionnaireData, permanent: boolean) {
    if (permanent) {
      if (!confirm(`Permanently delete "${q.name}"? This cannot be undone.`)) return
      try {
        const res = await fetch(`/api/adl/questionnaires/${q.id}`, { method: 'DELETE' })
        if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; showToast(d.error || 'Failed to delete.'); return }
        setQuestionnaires((prev) => prev.filter((x) => x.id !== q.id))
        setResponses((prev) => prev.filter((r) => r.questionnaireId !== q.id))
        if (page === 'builder') goPage('questionnaires')
        showToast('Questionnaire deleted')
        logAction(`Deleted ${q.name}`)
      } catch (err) { showError(err) }
      return
    }
    await setQStatus(q, 'trash')
  }

  async function saveQuestion(q: QuestionnaireData, question: QuestionData) {
    try {
      const res = await fetch(`/api/adl/questions/${question.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(question),
      })
      if (!res.ok) { showToast('Failed to save question'); return }
      const data = await res.json() as { question: QuestionData }
      setQuestionnaires((prev) => prev.map((x) => {
        if (x.id !== q.id) return x
        return { ...x, sections: x.sections.map((s) => ({ ...s, questions: s.questions.map((sq) => sq.id === data.question.id ? data.question : sq) })) }
      }))
      showToast('Question saved')
    } catch (err) { showError(err) }
  }

  async function deleteSelectedQuestion(q: QuestionnaireData, qid: string) {
    if (!confirm('Delete this question?')) return
    try {
      const res = await fetch(`/api/adl/questions/${qid}`, { method: 'DELETE' })
      if (!res.ok) { showToast('Failed to delete question'); return }
      setQuestionnaires((prev) => prev.map((x) => {
        if (x.id !== q.id) return x
        return { ...x, sections: x.sections.map((s) => ({ ...s, questions: s.questions.filter((sq) => sq.id !== qid) })) }
      }))
      setCurrentQuestionId(null)
      showToast('Question deleted')
    } catch (err) { showError(err) }
  }

  async function addNewQuestion(q: QuestionnaireData, sectionId: string) {
    try {
      const res = await fetch(`/api/adl/questionnaires/${q.id}/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId, type: 'short_text', question: 'Untitled question' }),
      })
      if (!res.ok) { showToast('Failed to add question'); return }
      const data = await res.json() as { question: QuestionData }
      setQuestionnaires((prev) => prev.map((x) => {
        if (x.id !== q.id) return x
        return { ...x, sections: x.sections.map((s) => s.id === sectionId ? { ...s, questions: [...s.questions, data.question] } : s) }
      }))
      setCurrentQuestionId(data.question.id)
      showToast('Question added')
    } catch (err) { showError(err) }
  }

  async function addNewSection(q: QuestionnaireData, title: string) {
    try {
      const res = await fetch(`/api/adl/questionnaires/${q.id}/sections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      })
      if (!res.ok) { showToast('Failed to add section'); return }
      const data = await res.json() as { section: SectionData }
      setQuestionnaires((prev) => prev.map((x) => x.id === q.id ? { ...x, sections: [...x.sections, { ...data.section, questions: [] }] } : x))
      showToast('Section added')
    } catch (err) { showError(err) }
  }

  async function setResponseStatus(r: ResponseData, status: ResponseData['status']) {
    try {
      const res = await fetch(`/api/adl/responses/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (!res.ok) { showToast('Failed to update status'); return }
      setResponses((prev) => prev.map((x) => x.id === r.id ? { ...x, status } : x))
      showToast(`Marked ${status}`)
    } catch (err) { showError(err) }
  }

  async function addNote(r: ResponseData, body: string) {
    if (!body.trim()) return
    try {
      const res = await fetch(`/api/adl/responses/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: body.trim() }),
      })
      const data = await res.json() as { notes?: ResponseData['notes']; error?: string }
      if (!res.ok) { showToast(data.error || 'Could not add note'); return }
      setResponses((prev) => prev.map((x) => x.id === r.id ? { ...x, notes: data.notes || x.notes } : x))
      setNoteDraft('')
      showToast('Note added')
    } catch (err) { showError(err) }
  }

  async function deleteResponsePermanently(r: ResponseData) {
    if (!confirm('Permanently delete this response?')) return
    try {
      const res = await fetch(`/api/adl/responses/${r.id}`, { method: 'DELETE' })
      if (!res.ok) { showToast('Could not delete'); return }
      setResponses((prev) => prev.filter((x) => x.id !== r.id))
      if (currentResponseId === r.id) setCurrentResponseId(null)
      showToast('Response deleted')
    } catch (err) { showError(err) }
  }

  async function handleCreateQuestionnaire(input: { name: string; mode: CreateMode; sourceId?: string; isDefault?: boolean }) {
    if (input.mode === 'import') {
      setShowCreateModal(false)
      goPage('developer')
      return
    }
    try {
      const res = await fetch('/api/adl/questionnaires', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          mode: input.mode === 'template' ? 'template' : input.mode,
          sourceId: input.sourceId,
          templateId: input.mode === 'template' ? input.sourceId : undefined,
          isDefault: input.isDefault,
        }),
      })
      const data = await res.json() as { questionnaire?: QuestionnaireData; error?: string }
      if (!res.ok || !data.questionnaire) { showToast(data.error || 'Failed to create'); return }
      setQuestionnaires((prev) => {
        const next = input.isDefault ? prev.map((x) => ({ ...x, isDefault: false })) : prev
        return [...next, data.questionnaire!]
      })
      setShowCreateModal(false)
      showToast('Questionnaire created')
      logAction(`Created ${data.questionnaire.name}`)
      openBuilder(data.questionnaire.id)
    } catch (err) { showError(err) }
  }

  async function saveWorkspace(input: WorkspaceSettings) {
    try {
      const res = await fetch('/api/adl/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      if (!res.ok) { showToast('Failed to save workspace'); return }
      const data = await res.json() as { workspace: WorkspaceSettings }
      setWorkspace(data.workspace)
      showToast('Workspace saved')
      logAction('Workspace settings updated')
    } catch (err) { showError(err) }
  }

  const filteredQuestionnaires = useMemo(() => {
    const query = qSearch.toLowerCase()
    return questionnaires
      .filter((q) => qStatusFilter === 'all' ? q.status !== 'trash' : q.status === qStatusFilter)
      .filter((q) => !query || q.name.toLowerCase().includes(query) || q.purpose.toLowerCase().includes(query) || q.slug.toLowerCase().includes(query))
  }, [questionnaires, qSearch, qStatusFilter])

  const filteredResponses = useMemo(() => {
    const query = responseSearch.toLowerCase()
    const now = Date.now()
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
    return responses
      .filter((r) => responseFilter === 'all' ? r.status !== 'trash' : r.status === responseFilter)
      .filter((r) => responseQuestionnaire === 'all' || r.questionnaireId === responseQuestionnaire)
      .filter((r) => responseProjectType === 'all' || r.projectType === responseProjectType)
      .filter((r) => {
        if (responseDate === 'all' || !r.createdAt) return true
        const t = new Date(r.createdAt).getTime()
        if (Number.isNaN(t)) return true
        if (responseDate === 'today') return t >= startOfToday.getTime()
        if (responseDate === '7d') return t >= now - 7 * 24 * 60 * 60 * 1000
        if (responseDate === '30d') return t >= now - 30 * 24 * 60 * 60 * 1000
        return true
      })
      .filter((r) => !query || `${r.name} ${r.company} ${r.email} ${r.projectType} ${r.questionnaireName || ''} ${r.answers.map((a) => a.join(' ')).join(' ')}`.toLowerCase().includes(query))
  }, [responses, responseFilter, responseSearch, responseQuestionnaire, responseProjectType, responseDate])

  const projectTypeOptions = useMemo(() => Array.from(new Set(responses.map((r) => r.projectType).filter(Boolean))).sort(), [responses])

  const currentQuestion = useMemo(() => {
    if (!currentQ || !currentQuestionId) return null
    for (const s of currentQ.sections) {
      const q = s.questions.find((x) => x.id === currentQuestionId)
      if (q) return q
    }
    return null
  }, [currentQ, currentQuestionId])

  useEffect(() => {
    if (!currentResponseId && filteredResponses[0]) setCurrentResponseId(filteredResponses[0].id)
  }, [filteredResponses, currentResponseId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowCommand(true)
      }
      if (e.key === 'Escape') { setShowCommand(false); setShowCreateModal(false); setShowShareModal(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const liveCount = questionnaires.filter((q) => q.status === 'live').length
  const draftCount = questionnaires.filter((q) => q.status === 'draft').length
  const overviewActivity = [
    ...responses.slice(0, 4).map((r) => ({ title: `New response from ${r.name}`, meta: `${r.submittedAt} · ${r.questionnaireName || 'Questionnaire'}`, color: '#C12029' })),
    ...audit.slice(0, 3).map((a) => ({ title: a.title, meta: a.time, color: '#18864B' })),
  ].slice(0, 6)

  return (
    <div className="v4">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <button className="brand" onClick={() => goPage('overview')}><AppsrowLogo className="h-auto w-[123px]" /></button>
        <div className="workspace-label">Workspace</div>
        <nav className="nav">
          <NavBtn icon="overview" label="Overview" active={page === 'overview'} onClick={() => goPage('overview')} />
          <NavBtn icon="form" label="Questionnaires" active={page === 'questionnaires' || page === 'builder'} onClick={() => goPage('questionnaires')} />
          <NavBtn icon="inbox" label="Responses" active={page === 'responses'} onClick={() => goPage('responses')} badge={newCount || undefined} />
          <NavBtn icon="template" label="Templates" active={page === 'templates'} onClick={() => goPage('templates')} />
        </nav>
        <div className="nav-divider" />
        <nav className="nav">
          <NavBtn icon="settings" label="Settings" active={page === 'settings'} onClick={() => goPage('settings')} />
          <NavBtn icon="code" label="Developer" active={page === 'developer'} onClick={() => goPage('developer')} />
        </nav>
        <div className="sidebar-spacer" />
        <div className="workspace-switch">
          <div className="workspace-mark">{initials(workspace.name)}</div>
          <div className="workspace-info">
            <div className="workspace-name">{workspace.name}</div>
            <div className="workspace-sub">{workspace.domain.replace(/^https?:\/\//, '')}</div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-nav-trigger" onClick={() => setSidebarOpen((v) => !v)}><Icon name="form" className="sm" /></button>
          <div className="topbar-title">{PAGE_TITLES[page]}</div>
          <button className="global-search" onClick={() => setShowCommand(true)}>
            <Icon name="search" className="sm" />
            <span>Search questionnaires, responses, settings</span>
            <span className="kbd">⌘K</span>
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => setShowCreateModal(true)}><Icon name="plus" className="xs" />New</button>
          <button className="icon-btn" title="Lock" onClick={() => void handleLogout()}><Icon name="lock" className="sm" /></button>
          <button className="avatar" title="Admin">AD</button>
        </header>

        {page === 'overview' && (
          <section className="page">
            <div className="page-head">
              <div>
                <div className="eyebrow">Today</div>
                <h1>Discovery workspace</h1>
                <p className="page-sub">Create questionnaires, collect client responses, and keep every flow in a clear lifecycle from draft to archive.</p>
              </div>
              <div className="head-actions">
                <button className="btn" onClick={() => goPage('templates')}><Icon name="template" className="sm" />Browse templates</button>
                <button className="btn primary" onClick={() => setShowCreateModal(true)}><Icon name="plus" className="sm" />New questionnaire</button>
              </div>
            </div>
            <div className="metrics">
              <Metric label="Questionnaires" value={questionnaires.filter((q) => q.status !== 'trash').length} meta={`${liveCount} live · ${draftCount} draft`} />
              <Metric label="Live forms" value={liveCount} meta="Accepting public responses" />
              <Metric label="New responses" value={newCount} meta={`${responses.length} total`} />
              <Metric label="Reviewed" value={responses.filter((r) => r.status === 'reviewed').length} meta="Ready for follow-up" />
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="card-head">
                  <div><h3>Recent responses</h3><div className="card-sub">Newest submissions across all questionnaires.</div></div>
                  <button className="btn sm" onClick={() => goPage('responses')}>Open inbox</button>
                </div>
                {responses.filter((r) => r.status !== 'trash').slice(0, 6).map((r) => (
                  <button key={r.id} className="response-row-mini" onClick={() => { setCurrentResponseId(r.id); goPage('responses') }}>
                    <div className="person-avatar">{initials(r.name)}</div>
                    <div className="activity-body">
                      <div className="activity-title">{r.name}</div>
                      <div className="activity-meta">{[r.company, r.projectType, r.submittedAt].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className={`status ${statusClass(r.status)}`}>{r.status}</span>
                  </button>
                ))}
                {!responses.length && <div className="response-empty">No responses yet.</div>}
              </div>
              <div className="card">
                <div className="card-head"><div><h3>Activity</h3><div className="card-sub">Recent workspace changes.</div></div></div>
                {overviewActivity.length ? overviewActivity.map((item, i) => (
                  <div key={i} className="activity-row">
                    <div className="activity-dot" style={{ background: item.color, boxShadow: `0 0 0 5px ${item.color}22` }} />
                    <div className="activity-body">
                      <div className="activity-title">{item.title}</div>
                      <div className="activity-meta">{item.meta}</div>
                    </div>
                  </div>
                )) : <div className="response-empty">Activity will appear as you work.</div>}
              </div>
            </div>
          </section>
        )}

        {page === 'questionnaires' && (
          <section className="page">
            <div className="page-head">
              <div>
                <div className="eyebrow">Workspace</div>
                <h1>Questionnaires</h1>
                <p className="page-sub">Create, publish and manage focused discovery flows with a safe lifecycle from draft to archive.</p>
              </div>
              <div className="head-actions">
                <button className="btn" onClick={() => goPage('templates')}><Icon name="template" className="sm" />Browse templates</button>
                <button className="btn primary" onClick={() => setShowCreateModal(true)}><Icon name="plus" className="sm" />New questionnaire</button>
              </div>
            </div>
            <div className="page-insights">
              <span className="insight-chip"><strong>{questionnaires.filter((q) => q.status !== 'trash').length}</strong> questionnaires</span>
              <span className="insight-chip"><span className="insight-dot green" /> <strong>{liveCount}</strong> live</span>
              <span className="insight-chip"><strong>{responses.length}</strong> total responses</span>
              <span className="insight-chip"><strong>{draftCount}</strong> drafts</span>
            </div>
            {defaultQ && (
              <div className="pinned">
                <div className="pinned-inner">
                  <div className="pinned-main">
                    <div className="pinned-kicker"><Icon name="star" className="xs" /> Pinned · Homepage form</div>
                    <div className="pinned-title">{defaultQ.name}</div>
                    <div className="pinned-desc">{defaultQ.purpose}</div>
                    <div className="pinned-meta">
                      <span>{qCount(defaultQ.sections)} questions</span>
                      <span>{logicCount(defaultQ.sections)} conditional</span>
                      <span>{responses.filter((r) => r.questionnaireId === defaultQ.id).length} responses</span>
                      <span className="mono">/{defaultQ.slug}</span>
                    </div>
                  </div>
                  <span className={`status ${statusClass(defaultQ.status)}`}>{defaultQ.status}</span>
                  <button className="btn sm" onClick={() => openShare(defaultQ)}><Icon name="share" className="xs" />Share</button>
                  <button className="btn sm primary" onClick={() => openBuilder(defaultQ.id)}><Icon name="form" className="xs" />Open builder</button>
                </div>
              </div>
            )}
            <div className="lifecycle-tabs">
              {['all', 'live', 'draft', 'closed', 'archived', 'trash'].map((status) => (
                <button key={status} className={`lifecycle-tab ${qStatusFilter === status ? 'active' : ''}`} onClick={() => setQStatusFilter(status)}>{status[0].toUpperCase() + status.slice(1)}</button>
              ))}
            </div>
            <div className="toolbar">
              <div className="search-box"><Icon name="search" className="sm" /><input placeholder="Search questionnaires" value={qSearch} onChange={(e) => setQSearch(e.target.value)} /></div>
              <div className="spacer" />
            </div>
            {qStatusFilter === 'trash' && (
              <div className="subtle-banner">
                <Icon name="trash" className="sm" />
                <div><strong>Trash is recoverable until you delete it permanently.</strong> Restore questionnaires here, or delete them if you are sure.</div>
              </div>
            )}
            <div className="table-card">
              <table>
                <thead><tr><th>Questionnaire</th><th>Status</th><th>Questions</th><th>Responses</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {filteredQuestionnaires.length === 0 ? (
                    <tr><td colSpan={6}><div className="response-empty">No questionnaires in this view.</div></td></tr>
                  ) : filteredQuestionnaires.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <button onClick={() => openBuilder(q.id)} className="item-title" style={{ background: 'none', border: 0, padding: 0 }}>{q.name}</button>
                        <div className="item-sub">{q.purpose || `/${q.slug}`}</div>
                      </td>
                      <td><span className={`status ${statusClass(q.status)}`}>{q.status}</span></td>
                      <td>{qCount(q.sections)}</td>
                      <td>{responses.filter((r) => r.questionnaireId === q.id).length}</td>
                      <td>{q.updatedAt ? new Date(q.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                      <td>
                        <div className="row-actions">
                          <details className="details-menu">
                            <summary className="more-btn"><Icon name="more" className="sm" /></summary>
                            <div className="menu-pop">
                              <button className="menu-item" onClick={() => openBuilder(q.id)}><Icon name="form" className="sm" />Open builder</button>
                              <button className="menu-item" onClick={() => openShare(q)}><Icon name="share" className="sm" />Share</button>
                              <button className="menu-item" onClick={() => void duplicateQuestionnaire(q)}><Icon name="copy" className="sm" />Duplicate</button>
                              {!q.isDefault && q.status !== 'trash' && <button className="menu-item" onClick={() => void makeHomepageForm(q)}>Use as homepage form</button>}
                              <div className="menu-sep" />
                              {q.status !== 'live' && q.status !== 'trash' && <button className="menu-item" onClick={() => void setQStatus(q, 'live')}>Publish</button>}
                              {q.status === 'live' && <button className="menu-item" onClick={() => void setQStatus(q, 'closed')}>Close responses</button>}
                              {q.status === 'live' && <button className="menu-item" onClick={() => void setQStatus(q, 'draft')}>Unpublish</button>}
                              {q.status !== 'archived' && q.status !== 'trash' && <button className="menu-item" onClick={() => void setQStatus(q, 'archived')}>Archive</button>}
                              {q.status === 'trash' && <button className="menu-item" onClick={() => void setQStatus(q, 'draft')}>Restore</button>}
                              {q.status !== 'trash' && <button className="menu-item danger" onClick={() => void handleDeleteQuestionnaire(q, false)}><Icon name="trash" className="sm" />Move to trash</button>}
                              {q.status === 'trash' && <button className="menu-item danger" onClick={() => void handleDeleteQuestionnaire(q, true)}>Delete permanently</button>}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {page === 'builder' && currentQ && (
          <section className="page builder-page">
            <div className="builder-top">
              <button className="icon-btn" onClick={() => goPage('questionnaires')}><Icon name="arrow-left" className="sm" /></button>
              <div className="builder-title"><strong>{currentQ.name}</strong><span className="mono">/{currentQ.slug}</span></div>
              <div className="builder-save">Saved</div>
              <span className="version-chip">{currentQ.status === 'live' ? 'Live' : currentQ.status}</span>
              <div className="spacer" />
              <div className="segmented">
                <button className={previewDevice === 'desktop' ? 'active' : ''} onClick={() => setPreviewDevice('desktop')}><Icon name="monitor" className="xs" /></button>
                <button className={previewDevice === 'mobile' ? 'active' : ''} onClick={() => setPreviewDevice('mobile')}><Icon name="phone" className="xs" /></button>
              </div>
              <button className="btn sm" onClick={() => openShare(currentQ)}><Icon name="share" className="xs" />Share</button>
              <details className="details-menu">
                <summary className="more-btn"><Icon name="more" className="sm" /></summary>
                <div className="menu-pop">
                  <button className="menu-item" onClick={() => window.open('/' + currentQ.slug.replace(/^\//, ''), '_blank')}><Icon name="eye" className="sm" />Preview questionnaire</button>
                  <button className="menu-item" onClick={() => void duplicateQuestionnaire(currentQ)}><Icon name="copy" className="sm" />Duplicate</button>
                  <div className="menu-sep" />
                  {currentQ.status === 'live' ? <button className="menu-item" onClick={() => void setQStatus(currentQ, 'closed')}>Close responses</button> : <button className="menu-item" onClick={() => void setQStatus(currentQ, 'live')}>Publish</button>}
                  <button className="menu-item danger" onClick={() => void handleDeleteQuestionnaire(currentQ, currentQ.status === 'trash')}><Icon name="trash" className="sm" />Move to trash</button>
                </div>
              </details>
              <button className="btn sm primary" onClick={() => void setQStatus(currentQ, currentQ.status === 'live' ? 'draft' : 'live')}>
                {currentQ.status === 'live' ? 'Unpublish' : 'Publish'}
              </button>
            </div>
            <div className="builder">
              <aside className="panel structure">
                <div className="panel-head">
                  <strong>Structure</strong>
                  <div className="spacer" />
                  <button className="mini-add" title="Add section" onClick={() => { const title = prompt('Section title:'); if (title) addNewSection(currentQ, title) }}><Icon name="plus" className="xs" /></button>
                </div>
                <div className="struct-search"><div className="search-box"><Icon name="search" className="xs" /><input placeholder="Search questions" value={questionSearch} onChange={(e) => setQuestionSearch(e.target.value)} /></div></div>
                {currentQ.sections.map((section, si) => {
                  const filtered = section.questions.filter((q) => !questionSearch || q.question.toLowerCase().includes(questionSearch.toLowerCase()))
                  const collapsed = collapsedSections[section.id]
                  return (
                    <div key={section.id} className={`section-block ${collapsed ? 'collapsed' : ''}`}>
                      <button className="section-head" onClick={() => setCollapsedSections((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}>
                        <span className="section-no">{String(si + 1).padStart(2, '0')}</span>
                        <span className="section-name">{section.title}</span>
                        <span className="section-count">{filtered.length}</span>
                        <button className="mini-add" onClick={(e) => { e.stopPropagation(); addNewQuestion(currentQ, section.id) }}><Icon name="plus" className="xs" /></button>
                      </button>
                      {!collapsed && filtered.map((q) => (
                        <button key={q.id} className={`q-item ${currentQuestionId === q.id ? 'active' : ''} ${q.active === false ? 'inactive' : ''}`} onClick={() => { setCurrentQuestionId(q.id); setPreviewPick('') }}>
                          <span className="drag">⋮⋮</span>
                          <span className="q-type-icon">{TYPE_LABELS[q.type].slice(0, 2).toUpperCase()}</span>
                          <span className="q-copy">
                            <span className="q-title">{q.question}</span>
                            <span className="q-flags">
                              {q.required && <span className="tiny-flag">Req</span>}
                              {q.logic?.showWhen?.conditions?.length ? <span className="tiny-flag">If</span> : null}
                              {!q.active && <span className="tiny-flag">Off</span>}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </aside>
              <section className="preview-stage">
                <div className={`preview-shell ${previewDevice === 'mobile' ? 'mobile' : ''}`}>
                  <div className="preview-brand">{currentQ.theme.showLogo !== false && <AppsrowLogo className="h-auto w-[105px]" />}</div>
                  <div className="preview-progress"><span style={{ width: currentQuestion && currentQ ? `${Math.max(8, (currentQ.sections.flatMap((s) => s.questions).findIndex((q) => q.id === currentQuestion.id) + 1) / Math.max(qCount(currentQ.sections), 1) * 100)}%` : '8%' }} /></div>
                  <div className="preview-body">
                    {currentQuestion ? (
                      <>
                        <div className="preview-step">Question {(currentQ.sections.flatMap((s) => s.questions).findIndex((q) => q.id === currentQuestion.id) + 1) || 1} of {qCount(currentQ.sections)}</div>
                        <div className="preview-question">{currentQuestion.question}</div>
                        {currentQuestion.helpText && <div className="preview-help">{currentQuestion.helpText}</div>}
                        {isChoiceType(currentQuestion.type) ? (
                          <div className="options">
                            {currentQuestion.options.map((opt) => (
                              <button key={opt} className={`option ${previewPick === opt ? 'selected' : ''}`} onClick={() => setPreviewPick(opt)}>
                                <span className={`radio ${currentQuestion.type === 'multi_select' ? 'square' : ''}`} />
                                <span>{opt}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="field" style={{ marginTop: 26 }}>
                            {currentQuestion.type === 'long_text'
                              ? <textarea className="textarea" placeholder={currentQuestion.placeholder || 'Your answer...'} readOnly />
                              : <input className="input" placeholder={currentQuestion.placeholder || 'Your answer...'} readOnly />}
                          </div>
                        )}
                        <div className="preview-foot">
                          <span className="preview-hint">Live preview · answers are not saved</span>
                          <button className="btn primary" onClick={() => {
                            const all = currentQ.sections.flatMap((s) => s.questions)
                            const idx = all.findIndex((q) => q.id === currentQuestion.id)
                            if (idx >= 0 && all[idx + 1]) { setCurrentQuestionId(all[idx + 1].id); setPreviewPick('') }
                          }}>Continue</button>
                        </div>
                      </>
                    ) : <div className="preview-help">Select a question to preview it.</div>}
                  </div>
                </div>
              </section>
              <aside className="panel properties">
                {currentQuestion ? (
                  <QuestionInspector
                    question={currentQuestion}
                    allQuestions={currentQ.sections.flatMap((s) => s.questions)}
                    onSave={(q) => saveQuestion(currentQ, q)}
                    onDelete={() => deleteSelectedQuestion(currentQ, currentQuestion.id)}
                  />
                ) : (
                  <div className="response-empty">Select a question to edit its settings.</div>
                )}
                <div className="prop-section">
                  <div className="prop-section-title">Questionnaire</div>
                  <div className="switch-row">
                    <div><div className="switch-title">Homepage form</div><div className="switch-sub">Opens on the public site root.</div></div>
                    <button className={`switch ${currentQ.isDefault ? 'on' : ''}`} onClick={() => { if (!currentQ.isDefault) void makeHomepageForm(currentQ) }}><span /></button>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        )}

        {page === 'responses' && (
          <section className="page">
            <div className="page-head">
              <div>
                <div className="eyebrow">Inbox</div>
                <h1>Client responses</h1>
                <p className="page-sub">Review submissions without changing the original answers. Use notes, lifecycle states and exports to keep qualification moving.</p>
              </div>
              <div className="head-actions">
                <button className="btn" disabled={!filteredResponses.length} onClick={() => exportResponses(filteredResponses, 'excel', 'intake-responses')}><Icon name="download" className="sm" />Excel</button>
                <button className="btn" disabled={!filteredResponses.length} onClick={() => exportResponses(filteredResponses, 'json', 'intake-responses')}>JSON</button>
                <button className="btn" disabled={!filteredResponses.length} onClick={() => exportResponses(filteredResponses, 'md', 'intake-responses')}>Markdown</button>
              </div>
            </div>
            <div className="lifecycle-tabs">
              {['all', 'new', 'reviewed', 'incomplete', 'archived', 'trash'].map((status) => (
                <button key={status} className={`lifecycle-tab ${responseFilter === status ? 'active' : ''}`} onClick={() => setResponseFilter(status)}>{status[0].toUpperCase() + status.slice(1)}</button>
              ))}
            </div>
            <div className="toolbar">
              <div className="search-box"><Icon name="search" className="sm" /><input placeholder="Search people, companies or answers" value={responseSearch} onChange={(e) => setResponseSearch(e.target.value)} /></div>
              <div className="spacer" />
              <div className="select-box">
                <select value={responseQuestionnaire} onChange={(e) => setResponseQuestionnaire(e.target.value)}>
                  <option value="all">All questionnaires</option>
                  {questionnaires.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </div>
              <div className="select-box">
                <select value={responseProjectType} onChange={(e) => setResponseProjectType(e.target.value)}>
                  <option value="all">All needs</option>
                  {projectTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="select-box">
                <select value={responseDate} onChange={(e) => setResponseDate(e.target.value)}>
                  <option value="all">Any time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </div>
            </div>
            {selectedResponses.length > 0 && (
              <div className="bulk-bar">
                <strong>{selectedResponses.length} selected</strong>
                <div className="spacer" />
                <button className="btn sm" onClick={() => { selectedResponses.forEach((id) => { const r = responses.find((x) => x.id === id); if (r) void setResponseStatus(r, 'reviewed') }); setSelectedResponses([]) }}>Mark reviewed</button>
                <button className="btn sm" onClick={() => { selectedResponses.forEach((id) => { const r = responses.find((x) => x.id === id); if (r) void setResponseStatus(r, 'archived') }); setSelectedResponses([]) }}>Archive</button>
                <button className="btn sm" onClick={() => exportResponses(responses.filter((r) => selectedResponses.includes(r.id)), 'excel', 'selected-responses')}>Export</button>
                <button className="btn sm danger" onClick={() => { selectedResponses.forEach((id) => { const r = responses.find((x) => x.id === id); if (r) void setResponseStatus(r, 'trash') }); setSelectedResponses([]) }}>Move to trash</button>
              </div>
            )}
            {responseFilter === 'trash' && (
              <div className="subtle-banner"><Icon name="trash" className="sm" /><div><strong>Deleted submissions stay in Trash until permanently deleted.</strong></div></div>
            )}
            <div className="responses-layout">
              <div className="response-list">
                <div className="response-list-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" className="table-check" checked={filteredResponses.length > 0 && selectedResponses.length === filteredResponses.length} onChange={(e) => setSelectedResponses(e.target.checked ? filteredResponses.map((r) => r.id) : [])} />
                    <strong style={{ fontSize: 12 }}>Responses</strong>
                    <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>{filteredResponses.length}</span>
                  </div>
                </div>
                {filteredResponses.length === 0 && <div className="response-empty">No responses here.</div>}
                {filteredResponses.map((r) => (
                  <div key={r.id} className={`response-item ${currentResponseId === r.id ? 'active' : ''}`} onClick={() => setCurrentResponseId(r.id)}>
                    <input type="checkbox" className="table-check" checked={selectedResponses.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSelectedResponses((prev) => e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id))} />
                    <div className="person-avatar">{initials(r.name)}</div>
                    <div className="response-main">
                      <div className="response-name">{r.name}</div>
                      <div className="response-company">{[!isPlaceholderValue(r.company) ? r.company : '', r.projectType || r.questionnaireName].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="response-time">{r.submittedAt}</div>
                  </div>
                ))}
              </div>
              <div className="response-detail">
                {currentResponse ? (
                  <>
                    <div className="response-detail-head">
                      <div className="person-avatar">{initials(currentResponse.name)}</div>
                      <div className="response-detail-meta">
                        <h2>{currentResponse.name}</h2>
                        <div className="meta-line">{[!isPlaceholderValue(currentResponse.company) ? currentResponse.company : '', !isPlaceholderValue(currentResponse.email) ? currentResponse.email : ''].filter(Boolean).join(' · ')}</div>
                        <div className="meta-line">Submitted {currentResponse.submittedAt} · {currentResponse.questionnaireName}</div>
                      </div>
                      <div className="detail-state-actions">
                        <span className={`status ${statusClass(currentResponse.status)}`}>{currentResponse.status}</span>
                        {currentResponse.status !== 'reviewed' && <button className="btn sm" onClick={() => void setResponseStatus(currentResponse, 'reviewed')}>Mark reviewed</button>}
                        {currentResponse.status === 'reviewed' && <button className="btn sm" onClick={() => void setResponseStatus(currentResponse, 'new')}>Mark new</button>}
                        {currentResponse.status !== 'archived' && currentResponse.status !== 'trash' && <button className="btn sm" onClick={() => void setResponseStatus(currentResponse, 'archived')}>Archive</button>}
                        {currentResponse.status === 'trash' ? (
                          <>
                            <button className="btn sm" onClick={() => void setResponseStatus(currentResponse, 'new')}>Restore</button>
                            <button className="btn sm danger" onClick={() => void deleteResponsePermanently(currentResponse)}>Delete</button>
                          </>
                        ) : (
                          <button className="btn sm danger" onClick={() => void setResponseStatus(currentResponse, 'trash')}>Trash</button>
                        )}
                      </div>
                    </div>
                    <div className="response-content">
                      <div className="subtle-banner"><Icon name="lock" className="sm" /><div><strong>Original answers are read-only.</strong> Add notes for corrections or follow-up.</div></div>
                      {Object.keys(currentResponse.snapshot).length > 0 && (
                        <div className="response-summary">
                          {Object.entries(currentResponse.snapshot).slice(0, 4).map(([k, v]) => (
                            <div key={k} className="summary-tile"><div className="summary-label">{k}</div><div className="summary-value">{v}</div></div>
                          ))}
                        </div>
                      )}
                      <div className="answer-section">
                        <div className="answer-section-title">Full responses</div>
                        {currentResponse.answers.map(([q, a]) => (
                          <div key={q} className="answer"><div className="answer-q">{q}</div><div className="answer-a">{a || '—'}</div></div>
                        ))}
                      </div>
                      <div className="note-box">
                        <div className="label">Internal notes</div>
                        <div className="notes-list">
                          {(currentResponse.notes || []).map((note) => (
                            <div key={note.id} className="note-item">
                              <div className="note-head"><span className="note-author">{note.author}</span><span>{note.time}</span></div>
                              <div className="note-body">{note.body}</div>
                            </div>
                          ))}
                        </div>
                        <textarea placeholder="Add a note for the team…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                          <button className="btn sm primary" onClick={() => void addNote(currentResponse, noteDraft)}>Add note</button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : <div className="response-empty">Select a response to review it.</div>}
              </div>
            </div>
          </section>
        )}

        {page === 'templates' && (
          <TemplatesPage
            questionnaires={questionnaires}
            onUse={(q) => void handleCreateQuestionnaire({ name: `${q.name} Project`, mode: 'template', sourceId: q.id })}
            onCreate={() => setShowCreateModal(true)}
          />
        )}

        {page === 'settings' && (
          <SettingsPage
            workspace={workspace}
            section={settingsSection}
            onSection={setSettingsSection}
            onSave={saveWorkspace}
            audit={audit}
            onLogout={() => void handleLogout()}
          />
        )}

        {page === 'developer' && (
          <DeveloperPage
            onImported={(q) => { setQuestionnaires((prev) => [...prev, q]); showToast(`Imported "${q.name}"`); goPage('questionnaires') }}
            onStatus={showToast}
          />
        )}
      </div>

      {showCreateModal && (
        <CreateModal
          questionnaires={questionnaires}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateQuestionnaire}
        />
      )}
      {showShareModal && currentQ && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setShowShareModal(false) }}>
          <div className="modal-card wide">
            <div className="modal-head"><h3>Share questionnaire</h3><div style={{ marginLeft: 'auto' }}><button className="more-btn" onClick={() => setShowShareModal(false)}>×</button></div></div>
            <div className="modal-body">
              <div className="field">
                <div className="label">Public URL</div>
                <div className="share-url">
                  <input className="input mono" readOnly value={publicUrl(currentQ)} />
                  <button className="btn" onClick={() => copyText(publicUrl(currentQ), 'Link copied')}>Copy</button>
                </div>
              </div>
              <p className="help">Anyone with the link can open a live questionnaire. Closed or draft forms are not publicly submittable.</p>
            </div>
          </div>
        </div>
      )}
      {showCommand && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) setShowCommand(false) }}>
          <div className="command">
            <div className="command-search"><Icon name="search" className="sm" /><input autoFocus placeholder="Search or jump to…" value={commandQuery} onChange={(e) => setCommandQuery(e.target.value)} /></div>
            <div className="command-list">
              <div className="command-group">Go to</div>
              {(Object.keys(PAGE_TITLES) as Page[]).filter((p) => p !== 'builder' && PAGE_TITLES[p].toLowerCase().includes(commandQuery.toLowerCase())).map((p) => (
                <button key={p} className="command-item" onClick={() => { setShowCommand(false); goPage(p) }}>{PAGE_TITLES[p]}</button>
              ))}
              <div className="command-group">Actions</div>
              <button className="command-item" onClick={() => { setShowCommand(false); setShowCreateModal(true) }}><Icon name="plus" className="sm" />Create questionnaire<span className="kbd">C</span></button>
            </div>
          </div>
        </div>
      )}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}

function NavBtn({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon name={icon} className="sm" />
      {label}
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </button>
  )
}

function Metric({ label, value, meta }: { label: string; value: number; meta: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-meta">{meta}</div>
    </div>
  )
}

function QuestionInspector({ question, allQuestions, onSave, onDelete }: {
  question: QuestionData
  allQuestions: QuestionData[]
  onSave: (q: QuestionData) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(question)
  const [logicEnabled, setLogicEnabled] = useState(!!question.logic?.showWhen?.conditions?.length)
  const questionKey = JSON.stringify(question)
  useEffect(() => {
    setDraft(question)
    setLogicEnabled(!!question.logic?.showWhen?.conditions?.length)
  }, [questionKey])
  const others = allQuestions.filter((q) => q.id !== draft.id)

  return (
    <>
      <div className="panel-head">
        <strong>Question settings</strong>
        <div className="spacer" />
        <details className="details-menu">
          <summary className="more-btn" style={{ width: 28, height: 28 }}><Icon name="more" className="xs" /></summary>
          <div className="menu-pop">
            <button className="menu-item danger" onClick={onDelete}><Icon name="trash" className="sm" />Delete question</button>
          </div>
        </details>
      </div>
      <div className="prop-section">
        <div className="prop-section-title">Content</div>
        <div className="field"><div className="label">Question</div><textarea className="textarea" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></div>
        <div className="field"><div className="label">Help text</div><textarea className="textarea" value={draft.helpText} onChange={(e) => setDraft({ ...draft, helpText: e.target.value })} /></div>
      </div>
      <div className="prop-section">
        <div className="prop-section-title">Answer</div>
        <div className="field">
          <div className="label">Response type</div>
          <select className="select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as QuestionData['type'] })}>
            {SUPPORTED_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        {isChoiceType(draft.type) && (
          <div className="field">
            <div className="label">Options</div>
            <textarea className="textarea" value={draft.options.join('\n')} onChange={(e) => setDraft({ ...draft, options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
          </div>
        )}
        {!isChoiceType(draft.type) && (
          <div className="field"><div className="label">Placeholder</div><input className="input" value={draft.placeholder} onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })} /></div>
        )}
        <div className="switch-row">
          <div><div className="switch-title">Required</div><div className="switch-sub">Must be answered to continue.</div></div>
          <button className={`switch ${draft.required ? 'on' : ''}`} onClick={() => setDraft({ ...draft, required: !draft.required })}><span /></button>
        </div>
        <div className="switch-row">
          <div><div className="switch-title">Include in questionnaire</div><div className="switch-sub">Hide without deleting historical data.</div></div>
          <button className={`switch ${draft.active ? 'on' : ''}`} onClick={() => setDraft({ ...draft, active: !draft.active })}><span /></button>
        </div>
      </div>
      <div className="prop-section">
        <div className="prop-section-title">Response mapping</div>
        <div className="field">
          <div className="label">Map to field</div>
          <select className="select" value={draft.role || ''} onChange={(e) => setDraft({ ...draft, role: (e.target.value || null) as QuestionRole | null })}>
            <option value="">Not mapped</option>
            {QUESTION_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
          <div className="help">Standard fields keep filtering and exports consistent.</div>
        </div>
      </div>
      <div className="prop-section">
        <div className="prop-section-title">Visibility</div>
        <div className="switch-row">
          <div><div className="switch-title">Conditional logic</div><div className="switch-sub">Only show when conditions match.</div></div>
          <button className={`switch ${logicEnabled ? 'on' : ''}`} onClick={() => {
            const next = !logicEnabled
            setLogicEnabled(next)
            if (!next) setDraft({ ...draft, logic: undefined })
            else if (!draft.logic) setDraft({ ...draft, logic: { showWhen: { match: 'any', conditions: [{ questionId: others[0]?.id || '', operator: 'equals', value: '' }] } } })
          }}><span /></button>
        </div>
        {logicEnabled && draft.logic && (
          <div className="logic-card">
            {draft.logic.showWhen.conditions.map((c, i) => (
              <div key={i} className="field" style={{ display: 'grid', gap: 6 }}>
                <select className="select" value={c.questionId} onChange={(e) => {
                  const conds = [...draft.logic!.showWhen.conditions]; conds[i] = { ...conds[i], questionId: e.target.value }
                  setDraft({ ...draft, logic: { showWhen: { ...draft.logic!.showWhen, conditions: conds } } })
                }}>{others.map((q) => <option key={q.id} value={q.id}>{q.question}</option>)}</select>
                <select className="select" value={c.operator} onChange={(e) => {
                  const conds = [...draft.logic!.showWhen.conditions]; conds[i] = { ...conds[i], operator: e.target.value as ShowOperator }
                  setDraft({ ...draft, logic: { showWhen: { ...draft.logic!.showWhen, conditions: conds } } })
                }}>{OPERATORS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}</select>
                <input className="input" value={c.value || ''} placeholder="Value" onChange={(e) => {
                  const conds = [...draft.logic!.showWhen.conditions]; conds[i] = { ...conds[i], value: e.target.value }
                  setDraft({ ...draft, logic: { showWhen: { ...draft.logic!.showWhen, conditions: conds } } })
                }} />
              </div>
            ))}
            <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setDraft({ ...draft, logic: { showWhen: { ...draft.logic!.showWhen, conditions: [...draft.logic!.showWhen.conditions, { questionId: others[0]?.id || '', operator: 'equals', value: '' }] } } })}>Add condition</button>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="label">Match</div>
              <select className="select" value={draft.logic.showWhen.match} onChange={(e) => setDraft({ ...draft, logic: { showWhen: { ...draft.logic!.showWhen, match: e.target.value as 'any' | 'all' } } })}>
                <option value="all">All conditions</option>
                <option value="any">Any condition</option>
              </select>
            </div>
          </div>
        )}
        <button className="btn sm primary" style={{ marginTop: 12 }} onClick={() => onSave(draft)}>Save question</button>
      </div>
    </>
  )
}

function CreateModal({ questionnaires, onClose, onCreate }: {
  questionnaires: QuestionnaireData[]
  onClose: () => void
  onCreate: (input: { name: string; mode: CreateMode; sourceId?: string; isDefault?: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<CreateMode>('blank')
  const [sourceId, setSourceId] = useState(questionnaires.find((q) => q.isDefault)?.id || questionnaires[0]?.id || '')
  const [makeDefault, setMakeDefault] = useState(false)

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card">
        <div className="modal-head"><h3>Create questionnaire</h3><div style={{ marginLeft: 'auto' }}><button className="more-btn" onClick={onClose}>×</button></div></div>
        <div className="modal-body">
          <div className="field"><div className="label">Questionnaire name</div><input className="input" autoFocus placeholder="e.g. Website Redesign Discovery" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="label">Start from</div>
          <div className="radio-stack">
            {([
              ['blank', 'Blank questionnaire', 'Start with an empty structure.'],
              ['template', 'Use template', 'Start from a reusable Appsrow or workspace template.'],
              ['duplicate', 'Duplicate existing', 'Copy structure, settings and logic without responses.'],
              ['import', 'Import JSON / CSV', 'Validate structured data before creating the flow.'],
            ] as const).map(([value, title, help]) => (
              <label key={value} className="radio-card">
                <input type="radio" name="createFrom" checked={mode === value} onChange={() => setMode(value)} />
                <div><strong>{title}</strong><div className="help">{help}</div></div>
              </label>
            ))}
          </div>
          {(mode === 'template' || mode === 'duplicate') && (
            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">{mode === 'template' ? 'Template' : 'Questionnaire'}</div>
              <select className="select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {questionnaires.filter((q) => q.status !== 'trash').map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </div>
          )}
          <div className="switch-row" style={{ marginTop: 12 }}>
            <div><div className="switch-title">Use as homepage form</div><div className="switch-sub">Publish this questionnaire on the public homepage.</div></div>
            <button className={`switch ${makeDefault ? 'on' : ''}`} onClick={() => setMakeDefault(!makeDefault)}><span /></button>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => {
            if (mode !== 'import' && !name.trim()) return
            onCreate({ name: name.trim() || 'Imported questionnaire', mode, sourceId, isDefault: makeDefault })
          }}>Create questionnaire</button>
        </div>
      </div>
    </div>
  )
}

function TemplatesPage({ questionnaires, onUse, onCreate }: {
  questionnaires: QuestionnaireData[]
  onUse: (q: QuestionnaireData) => void
  onCreate: () => void
}) {
  const [search, setSearch] = useState('')
  const usable = questionnaires.filter((q) => q.status !== 'trash' && q.name.toLowerCase().includes(search.toLowerCase()))
  const system = usable.filter((q) => q.isDefault)
  const workspace = usable.filter((q) => !q.isDefault)

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Reusable flows</div>
          <h1>Templates</h1>
          <p className="page-sub">Use protected Appsrow system templates or create editable workspace templates from proven questionnaires.</p>
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={onCreate}><Icon name="plus" className="sm" />Create questionnaire</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="search-box"><Icon name="search" className="sm" /><input placeholder="Search templates" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <div className="template-section">
        <div className="template-section-head">
          <div><h2 style={{ fontSize: 18 }}>Appsrow templates</h2><div className="card-sub">Protected system templates. Preview or use them, but they cannot be deleted.</div></div>
          <span className="standard-pill">Read only</span>
        </div>
        <div className="template-grid">
          {(system.length ? system : usable.slice(0, 1)).map((q) => (
            <div key={q.id} className="template-card">
              <div className="template-icon"><Icon name="star" className="sm" /></div>
              <h3>{q.name}</h3>
              <div className="template-desc">{q.purpose}</div>
              <div className="template-meta">
                <span>{qCount(q.sections)} questions</span>
                <button className="btn sm" onClick={() => onUse(q)}>Use template</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="template-section">
        <div className="template-section-head">
          <div><h2 style={{ fontSize: 18 }}>Workspace templates</h2><div className="card-sub">Questionnaires you can duplicate into a new draft.</div></div>
        </div>
        <div className="template-grid">
          {workspace.map((q) => (
            <div key={q.id} className="template-card">
              <div className="template-icon"><Icon name="template" className="sm" /></div>
              <h3>{q.name}</h3>
              <div className="template-desc">{q.purpose}</div>
              <div className="template-meta">
                <span>{qCount(q.sections)} questions · {q.status}</span>
                <button className="btn sm" onClick={() => onUse(q)}>Use template</button>
              </div>
            </div>
          ))}
          {!workspace.length && <div className="empty-template" style={{ gridColumn: '1 / -1', border: '1px dashed var(--line-strong)', borderRadius: 12, padding: 32, textAlign: 'center' }}>Save a questionnaire from the builder to reuse it here.</div>}
        </div>
      </div>
    </section>
  )
}

function SettingsPage({ workspace, section, onSection, onSave, audit, onLogout }: {
  workspace: WorkspaceSettings
  section: string
  onSection: (id: string) => void
  onSave: (input: WorkspaceSettings) => void
  audit: { title: string; time: string }[]
  onLogout: () => void
}) {
  const [name, setName] = useState(workspace.name)
  const [domain, setDomain] = useState(workspace.domain)
  const [theme, setTheme] = useState(workspace.defaultTheme)
  const [adminEmail, setAdminEmail] = useState(workspace.adminEmail || '')
  const [notifyOnSubmit, setNotifyOnSubmit] = useState(workspace.notifyOnSubmit !== false)
  useEffect(() => {
    setName(workspace.name); setDomain(workspace.domain); setTheme(workspace.defaultTheme)
    setAdminEmail(workspace.adminEmail || ''); setNotifyOnSubmit(workspace.notifyOnSubmit !== false)
  }, [workspace])

  const links = [
    ['general', 'settings', 'General'],
    ['appearance', 'palette', 'Appearance'],
    ['notifications', 'bell', 'Notifications'],
    ['members', 'user', 'Members'],
    ['retention', 'trash', 'Data retention'],
    ['security', 'lock', 'Security'],
    ['audit', 'inbox', 'Audit log'],
  ] as const

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Settings</h1>
          <p className="page-sub">Manage workspace defaults, client appearance, notifications, members, retention and security.</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-group">
            {links.slice(0, 3).map(([id, icon, label]) => (
              <button key={id} className={`settings-link ${section === id ? 'active' : ''}`} onClick={() => onSection(id)}><Icon name={icon} className="sm" />{label}</button>
            ))}
          </div>
          <div className="settings-group">
            {links.slice(3).map(([id, icon, label]) => (
              <button key={id} className={`settings-link ${section === id ? 'active' : ''}`} onClick={() => onSection(id)}><Icon name={icon} className="sm" />{label}</button>
            ))}
          </div>
        </aside>
        <div>
          {section === 'general' && (
            <div className="settings-panel">
              <div className="settings-panel-head"><h3>General</h3><div className="card-sub">Basic workspace details and client-facing domain.</div></div>
              <div className="settings-panel-body">
                <div className="form-grid">
                  <div className="full field"><div className="label">Workspace name</div><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div className="full field"><div className="label">Public domain</div><input className="input mono" value={domain} onChange={(e) => setDomain(e.target.value)} /><div className="help">Used when copying public questionnaire links.</div></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button className="btn primary" onClick={() => onSave({ name, domain, defaultTheme: theme, adminEmail, notifyOnSubmit })}>Save changes</button></div>
              </div>
            </div>
          )}
          {section === 'appearance' && (
            <div className="settings-panel">
              <div className="settings-panel-head"><h3>Appearance</h3><div className="card-sub">Workspace defaults. Individual questionnaires can override these values.</div></div>
              <div className="settings-panel-body">
                <div className="field"><div className="label">Default client theme</div>
                  <select className="select" value={theme} onChange={(e) => setTheme(e.target.value as ThemePreset)}>
                    <option value="light">Light</option><option value="dark">Dark</option><option value="editorial">Editorial</option>
                  </select>
                </div>
                <button className="btn primary" onClick={() => onSave({ name, domain, defaultTheme: theme, adminEmail, notifyOnSubmit })}>Save appearance</button>
              </div>
            </div>
          )}
          {section === 'notifications' && (
            <div className="settings-panel">
              <div className="settings-panel-head"><h3>Notifications</h3><div className="card-sub">Notification toggles save immediately.</div></div>
              <div className="settings-panel-body">
                <div className="field"><div className="label">Admin notification email</div><input className="input" type="email" placeholder="you@appsrow.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></div>
                <div className="switch-row">
                  <div><div className="switch-title">Email on new entry</div><div className="switch-sub">Requires RESEND_API_KEY in .env.local.</div></div>
                  <button className={`switch ${notifyOnSubmit ? 'on' : ''}`} onClick={() => setNotifyOnSubmit(!notifyOnSubmit)}><span /></button>
                </div>
                <button className="btn primary" onClick={() => onSave({ name, domain, defaultTheme: theme, adminEmail, notifyOnSubmit })}>Save notifications</button>
              </div>
            </div>
          )}
          {section === 'members' && (
            <div className="settings-panel">
              <div className="settings-panel-head"><h3>Members</h3><div className="card-sub">This workspace uses a shared admin password, not individual logins.</div></div>
              <div className="settings-panel-body">
                <div className="activity-row">
                  <div className="person-avatar">AD</div>
                  <div className="activity-body"><div className="activity-title">Admin</div><div className="activity-meta">Shared password access</div></div>
                  <span className="status live">Active</span>
                </div>
              </div>
            </div>
          )}
          {section === 'retention' && (
            <div className="settings-panel">
              <div className="settings-panel-head"><h3>Data retention</h3><div className="card-sub">Trash stays recoverable until you delete it permanently from the Questionnaires or Responses pages.</div></div>
              <div className="settings-panel-body"><p className="help">Move items to trash first, then delete permanently if you are sure.</p></div>
            </div>
          )}
          {section === 'security' && (
            <div className="settings-panel danger-zone">
              <div className="settings-panel-head"><h3>Security & change protection</h3><div className="card-sub">High-impact actions require confirmation. Lock the workspace when you leave.</div></div>
              <div className="settings-panel-body"><button className="btn danger" onClick={onLogout}><Icon name="lock" className="sm" />Lock workspace</button></div>
            </div>
          )}
          {section === 'audit' && (
            <div className="settings-panel">
              <div className="settings-panel-head"><h3>Audit log</h3><div className="card-sub">Important workspace actions from this session.</div></div>
              <div className="settings-panel-body">
                {audit.length ? audit.map((item, i) => (
                  <div key={i} className="audit-row">
                    <div className="audit-icon"><Icon name="inbox" className="xs" /></div>
                    <div><div className="audit-title">{item.title}</div><div className="audit-meta">{item.time}</div></div>
                  </div>
                )) : <p className="help">Actions you take in this session will appear here.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function DeveloperPage({ onImported, onStatus }: {
  onImported: (q: QuestionnaireData) => void
  onStatus: (msg: string) => void
}) {
  const [jsonInput, setJsonInput] = useState('')
  const [step, setStep] = useState(1)
  const [csvDragging, setCsvDragging] = useState(false)

  async function importPayload(payload: unknown) {
    const res = await fetch('/api/adl/questionnaires', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await res.json() as { questionnaire?: QuestionnaireData; error?: string }
    if (!res.ok || !data.questionnaire) { onStatus(data.error || 'Import failed.'); return }
    setStep(3)
    onImported(data.questionnaire)
  }

  async function handleJsonImport() {
    if (!jsonInput.trim()) { onStatus('Paste a JSON payload first.'); return }
    try {
      setStep(2)
      await importPayload(JSON.parse(jsonInput))
      setJsonInput('')
    } catch { onStatus('Invalid JSON — check syntax and try again.') }
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Developer</div>
          <h1>Developer & data</h1>
          <p className="page-sub">Import structured questionnaires, validate files, and inspect the admin API.</p>
        </div>
      </div>
      <div className="developer-grid">
        <div className="card">
          <div className="card-head"><div><h3>Import questionnaire</h3><div className="card-sub">Upload → Validate → Review & import.</div></div><span className="status draft">Step {step} of 3</span></div>
          <div style={{ padding: 16 }}>
            <div className="import-steps">
              <div className={`import-step ${step >= 1 ? 'active' : ''}`}>1. Upload</div>
              <div className={`import-step ${step >= 2 ? 'active' : ''}`}>2. Validate</div>
              <div className={`import-step ${step >= 3 ? 'active' : ''}`}>3. Review & import</div>
            </div>
            <textarea className="textarea mono" style={{ minHeight: 140, fontSize: 12 }} placeholder={'{\n  "questionnaire": { "name": "...", "slug": "..." },\n  "sections": [],\n  "questions": []\n}'} value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} />
            <div
              className="dropzone"
              style={{ marginTop: 12, minHeight: 120 }}
              onDragOver={(e) => { e.preventDefault(); setCsvDragging(true) }}
              onDragLeave={() => setCsvDragging(false)}
              onDrop={(e) => { e.preventDefault(); setCsvDragging(false); const f = e.dataTransfer.files[0]; if (f) void importFile(f, importPayload, onStatus, setStep) }}
            >
              <div>
                <Icon name="upload" />
                <h3>{csvDragging ? 'Drop to import' : 'Drop JSON or CSV here'}</h3>
                <label className="btn sm" style={{ marginTop: 14 }}>
                  Choose file
                  <input type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={(e) => { if (e.target.files?.[0]) void importFile(e.target.files[0], importPayload, onStatus, setStep) }} />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" onClick={() => void handleJsonImport()}>Import JSON</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>JSON structure</h3><div className="card-sub">Expected questionnaire schema.</div></div></div>
          <div style={{ padding: 16 }}>
            <pre className="codebox">{`{
  "questionnaire": {
    "name": "Website Discovery",
    "slug": "website-discovery"
  },
  "sections": [
    { "id": "start", "title": "Start here" }
  ],
  "questions": [
    {
      "id": "q1",
      "sectionId": "start",
      "type": "single_select",
      "required": true
    }
  ]
}`}</pre>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div><h3>API endpoints</h3><div className="card-sub">Session-authenticated admin API. Scoped API keys are not enabled.</div></div></div>
        <div style={{ padding: '4px 18px 8px' }}>
          {[
            ['GET', '/api/adl/questionnaires', 'List questionnaires'],
            ['POST', '/api/adl/questionnaires', 'Create, duplicate, or import'],
            ['PUT', '/api/adl/questionnaires/:id', 'Update status, theme, homepage'],
            ['DELETE', '/api/adl/questionnaires/:id', 'Permanently delete'],
            ['PUT', '/api/adl/responses/:id', 'Status or internal note'],
            ['DELETE', '/api/adl/responses/:id', 'Permanently delete a response'],
          ].map(([method, path, desc]) => (
            <div key={method + path} className="api-row">
              <div className={`method ${method.toLowerCase()}`}>{method}</div>
              <div><div className="endpoint">{path}</div><div className="api-desc">{desc}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

async function importFile(
  file: File,
  importPayload: (payload: unknown) => Promise<void>,
  onStatus: (msg: string) => void,
  setStep: (n: number) => void,
) {
  const text = await file.text()
  setStep(2)
  if (file.name.endsWith('.json') || file.type.includes('json')) {
    try { await importPayload(JSON.parse(text)) } catch { onStatus('Invalid JSON file.') }
    return
  }
  const payload = parseCsvToJson(text)
  if (!payload) { onStatus('Could not parse the CSV. Include a "question" column.'); return }
  await importPayload(payload)
}

function parseCsvToJson(csvText: string) {
  const lines = csvText.trim().split('\n').map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')))
  if (lines.length < 2) return null
  const headers = lines[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'))
  const sectionIdx = headers.indexOf('section')
  const questionIdx = headers.indexOf('question')
  const typeIdx = headers.indexOf('type')
  const requiredIdx = headers.indexOf('required')
  const optionsIdx = headers.indexOf('options')
  const helpIdx = headers.indexOf('help_text')
  const placeholderIdx = headers.indexOf('placeholder')
  if (questionIdx < 0) return null
  const sectionMap: Record<string, { id: string; title: string; order: number }> = {}
  const questions: Record<string, unknown>[] = []
  let sectionOrder = 0
  let questionOrder = 0
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]
    if (!row[questionIdx]?.trim()) continue
    const secTitle = sectionIdx >= 0 && row[sectionIdx] ? row[sectionIdx] : 'General'
    const secKey = secTitle.toLowerCase()
    if (!sectionMap[secKey]) {
      sectionOrder++
      sectionMap[secKey] = { id: `csv_sec_${sectionOrder}`, title: secTitle, order: sectionOrder }
    }
    questionOrder++
    questions.push({
      id: `csv_q_${questionOrder}`,
      sectionId: sectionMap[secKey].id,
      type: typeIdx >= 0 && row[typeIdx] ? row[typeIdx].toLowerCase().replace(/\s+/g, '_') : 'short_text',
      question: row[questionIdx],
      helpText: helpIdx >= 0 ? row[helpIdx] || '' : '',
      placeholder: placeholderIdx >= 0 ? row[placeholderIdx] || '' : '',
      required: requiredIdx >= 0 ? row[requiredIdx]?.toLowerCase() === 'true' || row[requiredIdx] === '1' : false,
      active: true,
      order: questionOrder,
      options: optionsIdx >= 0 && row[optionsIdx] ? row[optionsIdx].split('|').map((s) => s.trim()).filter(Boolean) : [],
    })
  }
  return {
    questionnaire: { name: 'Imported from CSV', slug: `csv-import-${Date.now().toString(36)}`, purpose: 'Imported from spreadsheet.' },
    sections: Object.values(sectionMap),
    questions,
  }
}
