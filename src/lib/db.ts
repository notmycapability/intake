import { neon, NeonQueryFunction } from '@neondatabase/serverless'
import type {
  QuestionnaireData,
  SectionData,
  QuestionData,
  ThemeSettings,
  ResponseData,
  WorkspaceSettings,
  QuestionType,
  Logic,
  QuestionRole,
  QuestionnaireStatus,
  ThemePreset,
  ShowCondition,
  ResponseNote,
} from './questions'
import {
  buildSnapshot,
  computeClarity,
  extractContact,
  isPlaceholderValue,
  labeledAnswers,
  parseStoredAnswers,
  responseTitle,
} from './contactFields'

let sql: NeonQueryFunction<false, false> | null = null
let cachedDatabaseUrl: string | null = null

function normalizeDatabaseUrl(value: string): string {
  let url = value.trim().replace(/^["']|["']$/g, '')
  if (url.startsWith('postgresql:postgresql://') || url.startsWith('postgres:postgresql://')) {
    url = url.replace(/^postgres(ql)?:/, '')
  }
  return url
}

function isDbConnectError(error: unknown): boolean {
  const parts: string[] = []
  if (error instanceof Error) {
    parts.push(error.name, error.message)
    if (error.cause instanceof Error) parts.push(error.cause.message)
  } else {
    parts.push(String(error))
  }
  return /fetch failed|connecting to database|ECONNRESET|ETIMEDOUT|ENOTFOUND|Connect Timeout|unavailable/i.test(parts.join(' '))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('Missing DATABASE_URL. Add it to .env.local and restart the app.')
  const normalized = normalizeDatabaseUrl(databaseUrl)
  if (!sql || cachedDatabaseUrl !== normalized) {
    sql = neon(normalized)
    cachedDatabaseUrl = normalized
  }
  return sql
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id)
}

// --- Workspace ---

export async function getWorkspace(): Promise<WorkspaceSettings> {
  const db = getDb()
  const rows = await db`SELECT name, domain, default_theme, admin_email, notify_on_submit FROM workspace WHERE id = 1`
  if (!rows[0]) {
    return { name: 'Appsrow Discovery', domain: 'discover.appsrow.com', defaultTheme: 'light', adminEmail: '', notifyOnSubmit: true }
  }
  const r = rows[0] as Record<string, unknown>
  return {
    name: String(r.name),
    domain: String(r.domain),
    defaultTheme: (r.default_theme as ThemePreset) || 'light',
    adminEmail: String(r.admin_email || ''),
    notifyOnSubmit: r.notify_on_submit !== false,
  }
}

export async function updateWorkspace(input: WorkspaceSettings): Promise<WorkspaceSettings> {
  const db = getDb()
  await db`
    UPDATE workspace SET
      name = ${input.name},
      domain = ${input.domain},
      default_theme = ${input.defaultTheme},
      admin_email = ${input.adminEmail || ''},
      notify_on_submit = ${input.notifyOnSubmit !== false}
    WHERE id = 1
  `
  return input
}

// --- Questionnaires ---

function mapTheme(row: Record<string, unknown>): ThemeSettings {
  return {
    preset: (row.theme_preset as ThemePreset) || 'light',
    heading: (row.theme_heading as 'large' | 'compact') || 'large',
    width: (row.theme_width as 'wide' | 'focused') || 'wide',
    progress: (row.theme_progress as 'fraction' | 'minimal') || 'fraction',
    showLogo: row.theme_show_logo !== false,
  }
}

export async function listQuestionnaires(): Promise<QuestionnaireData[]> {
  const db = getDb()
  const qRows = await db`SELECT * FROM questionnaires ORDER BY is_default DESC, created_at ASC`
  const sRows = await db`SELECT * FROM sections ORDER BY sort_order ASC`
  const questionRows = await db`SELECT * FROM questions ORDER BY sort_order ASC`

  const sectionsByQid = new Map<string, SectionData[]>()
  for (const s of sRows as Record<string, unknown>[]) {
    const qid = String(s.questionnaire_id)
    if (!sectionsByQid.has(qid)) sectionsByQid.set(qid, [])
    sectionsByQid.get(qid)!.push({
      id: String(s.id),
      title: String(s.title),
      order: Number(s.sort_order),
      questions: [],
    })
  }

  const questionsBySid = new Map<string, QuestionData[]>()
  for (const q of questionRows as Record<string, unknown>[]) {
    const sid = String(q.section_id)
    if (!questionsBySid.has(sid)) questionsBySid.set(sid, [])
    questionsBySid.get(sid)!.push(mapQuestion(q))
  }

  for (const sections of sectionsByQid.values()) {
    for (const s of sections) {
      s.questions = questionsBySid.get(s.id) || []
    }
  }

  return (qRows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    isDefault: Boolean(r.is_default),
    name: String(r.name),
    slug: String(r.slug),
    purpose: String(r.purpose),
    status: (r.status as QuestionnaireStatus) || 'draft',
    createdAt: String(r.created_at).slice(0, 10),
    updatedAt: String(r.updated_at).slice(0, 10),
    theme: mapTheme(r),
    sections: sectionsByQid.get(String(r.id)) || [],
  }))
}

export async function getQuestionnaire(id: string): Promise<QuestionnaireData | null> {
  if (!isSafeId(id)) return null
  const all = await listQuestionnaires()
  return all.find((q) => q.id === id) || null
}

export async function getQuestionnaireBySlug(slug: string): Promise<QuestionnaireData | null> {
  const all = await listQuestionnaires()
  return all.find((q) => q.slug === slug) || null
}

export async function createQuestionnaire(input: {
  name: string
  slug: string
  purpose: string
  status?: QuestionnaireStatus
  isDefault?: boolean
  theme?: Partial<ThemeSettings>
  sections?: SectionData[]
}): Promise<QuestionnaireData> {
  const db = getDb()
  const id = `qnaire_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const theme: ThemeSettings = {
    preset: input.theme?.preset || 'light',
    heading: input.theme?.heading || 'large',
    width: input.theme?.width || 'wide',
    progress: input.theme?.progress || 'fraction',
    showLogo: input.theme?.showLogo !== false,
  }

  const isDefault = Boolean(input.isDefault)
  const status = isDefault ? 'live' : (input.status || 'draft')
  if (isDefault) {
    await db`UPDATE questionnaires SET is_default = false WHERE is_default = true`
  }
  await db`
    INSERT INTO questionnaires (id, is_default, name, slug, purpose, status, theme_preset, theme_heading, theme_width, theme_progress, theme_show_logo)
    VALUES (${id}, ${isDefault}, ${input.name}, ${input.slug}, ${input.purpose}, ${status},
      ${theme.preset}, ${theme.heading}, ${theme.width}, ${theme.progress}, ${theme.showLogo})
  `

  const sections = input.sections || []
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si]
    const sortOrder = si + 1
    await db`INSERT INTO sections (id, questionnaire_id, title, sort_order) VALUES (${s.id}, ${id}, ${s.title}, ${sortOrder})`
    for (let qi = 0; qi < s.questions.length; qi++) {
      const q = s.questions[qi]
      const qOrder = qi + 1
      const helpText = q.helpText || ''
      const placeholder = q.placeholder || ''
      const optionsJson = JSON.stringify(q.options || [])
      const logicJson = q.logic ? JSON.stringify(q.logic) : null
      const role = q.role || null
      await db`
        INSERT INTO questions (id, section_id, sort_order, question, help_text, placeholder, type, required, active, options, logic, role)
        VALUES (${q.id}, ${s.id}, ${qOrder}, ${q.question}, ${helpText}, ${placeholder}, ${q.type},
          ${q.required}, ${q.active !== false}, ${optionsJson}::jsonb, ${logicJson}::jsonb, ${role})
      `
    }
  }

  return (await getQuestionnaire(id))!
}

export async function updateQuestionnaire(id: string, input: {
  name?: string
  slug?: string
  purpose?: string
  status?: QuestionnaireStatus
  isDefault?: boolean
  theme?: Partial<ThemeSettings>
}): Promise<QuestionnaireData | null> {
  if (!isSafeId(id)) return null
  const db = getDb()
  const existing = await getQuestionnaire(id)
  if (!existing) return null

  const name = input.name ?? existing.name
  const slug = input.slug ?? existing.slug
  const purpose = input.purpose ?? existing.purpose
  const makeDefault = input.isDefault === true
  const requestedStatus = input.status ?? existing.status
  const status = makeDefault ? 'live' : requestedStatus
  const theme = { ...existing.theme, ...input.theme }
  let isDefault = makeDefault ? true : input.isDefault === false ? false : existing.isDefault
  if (status === 'trash' || status === 'archived') isDefault = false

  if (makeDefault) {
    await db`UPDATE questionnaires SET is_default = false WHERE id <> ${id}`
  }

  await db`
    UPDATE questionnaires SET name=${name}, slug=${slug}, purpose=${purpose}, status=${status},
    is_default=${isDefault},
    theme_preset=${theme.preset}, theme_heading=${theme.heading}, theme_width=${theme.width},
    theme_progress=${theme.progress}, theme_show_logo=${theme.showLogo}, updated_at=now()
    WHERE id=${id}
  `

  return getQuestionnaire(id)
}

export async function deleteQuestionnaire(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false
  const db = getDb()
  await db`DELETE FROM questionnaires WHERE id = ${id}`
  return true
}

// --- Sections ---

export async function addSection(questionnaireId: string, title: string): Promise<SectionData> {
  const db = getDb()
  const id = `section_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const maxRows = await db`SELECT COALESCE(MAX(sort_order),0)::int AS max FROM sections WHERE questionnaire_id = ${questionnaireId}`
  const order = Number(maxRows[0]?.max ?? 0) + 1
  await db`INSERT INTO sections (id, questionnaire_id, title, sort_order) VALUES (${id}, ${questionnaireId}, ${title}, ${order})`
  await db`UPDATE questionnaires SET updated_at = now() WHERE id = ${questionnaireId}`
  return { id, title, order, questions: [] }
}

// --- Questions ---

function mapQuestion(row: Record<string, unknown>): QuestionData {
  let options: string[] = []
  if (Array.isArray(row.options)) {
    options = row.options.map((o: unknown) => typeof o === 'string' ? o : (o && typeof o === 'object' && 'label' in o ? String((o as {label: string}).label) : String(o)))
  } else if (typeof row.options === 'string') {
    try { options = JSON.parse(row.options) } catch { /* empty */ }
  }

  let logic: Logic | undefined
  const rawLogic = row.logic
  if (rawLogic && typeof rawLogic === 'object' && !Array.isArray(rawLogic)) {
    const parsed = rawLogic as { showWhen?: { match?: string; conditions?: unknown[] } }
    if (parsed.showWhen?.conditions?.length) {
      logic = { showWhen: { match: parsed.showWhen.match === 'all' ? 'all' : 'any', conditions: (parsed.showWhen.conditions as ShowCondition[]).filter(c => c && c.questionId) } }
    }
  }

  return {
    id: String(row.id),
    sectionId: String(row.section_id),
    type: row.type as QuestionType,
    question: String(row.question),
    helpText: String(row.help_text ?? ''),
    placeholder: String(row.placeholder ?? ''),
    required: Boolean(row.required),
    active: row.active !== false,
    options,
    logic,
    role: (row.role as QuestionRole | null) || undefined,
    order: Number(row.sort_order),
  }
}

export async function addQuestion(sectionId: string, data: Partial<QuestionData>): Promise<QuestionData> {
  const db = getDb()
  const id = data.id || `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const maxRows = await db`SELECT COALESCE(MAX(sort_order),0)::int AS max FROM questions WHERE section_id = ${sectionId}`
  const order = Number(maxRows[0]?.max ?? 0) + 1

  const qText = data.question || 'Untitled question'
  const qHelp = data.helpText || ''
  const qPlaceholder = data.placeholder || ''
  const qType = data.type || 'short_text'
  const qRequired = data.required ?? false
  const qActive = data.active !== false
  const qOptions = JSON.stringify(data.options || [])
  const qLogic = data.logic ? JSON.stringify(data.logic) : null
  const qRole = data.role || null
  await db`
    INSERT INTO questions (id, section_id, sort_order, question, help_text, placeholder, type, required, active, options, logic, role)
    VALUES (${id}, ${sectionId}, ${order}, ${qText}, ${qHelp}, ${qPlaceholder}, ${qType},
      ${qRequired}, ${qActive}, ${qOptions}::jsonb, ${qLogic}::jsonb, ${qRole})
  `

  // update questionnaire timestamp
  const sectionRows = await db`SELECT questionnaire_id FROM sections WHERE id = ${sectionId} LIMIT 1`
  if (sectionRows[0]) {
    await db`UPDATE questionnaires SET updated_at = now() WHERE id = ${String(sectionRows[0].questionnaire_id)}`
  }

  return { id, sectionId, type: (data.type || 'short_text') as QuestionType, question: data.question || 'Untitled question', helpText: data.helpText || '', placeholder: data.placeholder || '', required: data.required ?? false, active: data.active !== false, options: data.options || [], logic: data.logic, role: data.role, order }
}

export async function updateQuestion(id: string, data: Partial<QuestionData>): Promise<QuestionData | null> {
  if (!isSafeId(id)) return null
  const db = getDb()
  const existing = await db`SELECT * FROM questions WHERE id = ${id} LIMIT 1`
  if (!existing[0]) return null

  const row = existing[0] as Record<string, unknown>
  const q = mapQuestion(row)

  const updated = {
    question: data.question ?? q.question,
    helpText: data.helpText ?? q.helpText,
    placeholder: data.placeholder ?? q.placeholder,
    type: data.type ?? q.type,
    required: data.required ?? q.required,
    active: data.active ?? q.active,
    options: data.options ?? q.options,
    logic: data.logic !== undefined ? data.logic : q.logic,
    role: data.role !== undefined ? data.role : q.role,
  }

  const uOptions = JSON.stringify(updated.options)
  const uLogic = updated.logic ? JSON.stringify(updated.logic) : null
  const uRole = updated.role || null
  await db`
    UPDATE questions SET question=${updated.question}, help_text=${updated.helpText}, placeholder=${updated.placeholder},
    type=${updated.type}, required=${updated.required}, active=${updated.active},
    options=${uOptions}::jsonb, logic=${uLogic}::jsonb, role=${uRole}
    WHERE id=${id}
  `

  return { ...q, ...updated }
}

export async function deleteQuestion(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false
  const db = getDb()
  await db`DELETE FROM questions WHERE id = ${id}`
  return true
}

// --- Submissions (Responses) ---

type QuestionLookup = Map<string, QuestionData[]>

async function loadQuestionsByQuestionnaire(): Promise<QuestionLookup> {
  const db = getDb()
  const rows = await db`
    SELECT q.id, q.section_id, q.sort_order, q.question, q.help_text, q.placeholder, q.type,
           q.required, q.active, q.options, q.logic, q.role, s.questionnaire_id
    FROM questions q
    JOIN sections s ON s.id = q.section_id
    ORDER BY q.sort_order ASC
  ` as Record<string, unknown>[]

  const lookup: QuestionLookup = new Map()
  for (const row of rows) {
    const qid = String(row.questionnaire_id)
    if (!lookup.has(qid)) lookup.set(qid, [])
    lookup.get(qid)!.push(mapQuestion(row))
  }
  return lookup
}

export async function listResponses(questionnaireId?: string): Promise<ResponseData[]> {
  const db = getDb()
  let rows: Record<string, unknown>[]
  if (questionnaireId) {
    rows = await db`
      SELECT s.*, q.name AS questionnaire_name
      FROM submissions s LEFT JOIN questionnaires q ON q.id = s.questionnaire_id
      WHERE s.questionnaire_id = ${questionnaireId}
      ORDER BY s.created_at DESC
    ` as Record<string, unknown>[]
  } else {
    rows = await db`
      SELECT s.*, q.name AS questionnaire_name
      FROM submissions s LEFT JOIN questionnaires q ON q.id = s.questionnaire_id
      ORDER BY s.created_at DESC
    ` as Record<string, unknown>[]
  }
  const questions = await loadQuestionsByQuestionnaire()
  return rows.map((row) => mapResponse(row, questions.get(String(row.questionnaire_id)) || []))
}

function mapResponse(r: Record<string, unknown>, questions: QuestionData[] = []): ResponseData {
  const stored = parseStoredAnswers(r.answers)
  const contact = extractContact(questions, stored)
  const name = isPlaceholderValue(String(r.name || '')) ? contact.name : String(r.name)
  const email = isPlaceholderValue(String(r.email || '')) ? contact.email : String(r.email)
  const company = isPlaceholderValue(String(r.company || '')) ? contact.company : String(r.company)
  const projectType = String(r.project_type || '') || contact.projectType
  const answers = labeledAnswers(questions, stored)
  const snapshot = (r.snapshot && typeof r.snapshot === 'object' && !Array.isArray(r.snapshot)
    ? r.snapshot
    : {}) as Record<string, string>
  const snapshotHasData = Object.values(snapshot).some((value) => !isPlaceholderValue(String(value)))
  const hydratedSnapshot = snapshotHasData ? snapshot : buildSnapshot({ name, email, company, projectType })

  return {
    id: String(r.id),
    questionnaireId: String(r.questionnaire_id),
    questionnaireName: r.questionnaire_name ? String(r.questionnaire_name) : undefined,
    name: responseTitle({ name, email, company, projectType }),
    company,
    email,
    status: (r.status as ResponseData['status']) || 'new',
    clarity: Number(r.clarity) || computeClarity(questions, stored),
    submittedAt: formatTs(r.created_at),
    createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : '',
    projectType,
    snapshot: hydratedSnapshot,
    ready: Array.isArray(r.ready) ? r.ready as string[] : [],
    clarify: Array.isArray(r.clarify) ? r.clarify as string[] : [],
    answers,
    notes: parseNotes(r.notes),
  }
}

function formatTs(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 24 * 60 * 60 * 1000) return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  if (diff < 48 * 60 * 60 * 1000) return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export async function getResponse(id: string): Promise<ResponseData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const db = getDb()
  const rows = await db`
    SELECT s.*, q.name AS questionnaire_name
    FROM submissions s JOIN questionnaires q ON q.id = s.questionnaire_id
    WHERE s.id = ${id} LIMIT 1
  ` as Record<string, unknown>[]
  if (!rows[0]) return null
  const questions = await loadQuestionsByQuestionnaire()
  return mapResponse(rows[0], questions.get(String(rows[0].questionnaire_id)) || [])
}

export async function insertSubmission(input: {
  questionnaireId: string
  name: string
  email: string
  company: string
  projectType: string
  answers: Record<string, unknown>
  snapshot?: Record<string, string>
  ready?: string[]
  clarify?: string[]
  clarity?: number
}): Promise<{ id: string }> {
  const db = getDb()
  const sAnswers = JSON.stringify(input.answers)
  const sSnapshot = JSON.stringify(input.snapshot || {})
  const sReady = JSON.stringify(input.ready || [])
  const sClarify = JSON.stringify(input.clarify || [])
  const sClarity = input.clarity || 0
  const rows = await db`
    INSERT INTO submissions (questionnaire_id, name, email, company, project_type, answers, snapshot, ready, clarify, clarity)
    VALUES (${input.questionnaireId}, ${input.name}, ${input.email}, ${input.company}, ${input.projectType},
      ${sAnswers}::jsonb, ${sSnapshot}::jsonb, ${sReady}::jsonb, ${sClarify}::jsonb, ${sClarity})
    RETURNING id
  `
  return { id: String(rows[0].id) }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseNotes(raw: unknown): ResponseNote[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || ''),
      author: String(item.author || 'Admin'),
      time: String(item.time || ''),
      body: String(item.body || ''),
    }))
    .filter((item) => item.id && item.body)
}

export async function updateResponseStatus(id: string, status: ResponseData['status']): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  const db = getDb()
  await db`UPDATE submissions SET status = ${status} WHERE id = ${id}`
  return true
}

export async function deleteResponse(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  const db = getDb()
  await db`DELETE FROM submissions WHERE id = ${id}`
  return true
}

export async function addResponseNote(id: string, note: ResponseNote): Promise<ResponseNote[] | null> {
  if (!UUID_RE.test(id)) return null
  const existing = await getResponse(id)
  if (!existing) return null
  const notes = [...existing.notes, note]
  const db = getDb()
  await db`UPDATE submissions SET notes = ${JSON.stringify(notes)}::jsonb WHERE id = ${id}`
  return notes
}

// --- Seed ---

export async function ensureSeeded(): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const db = getDb()
      await runMigrations(db)
      const countRows = await db`SELECT COUNT(*)::int AS count FROM questionnaires`
      if (Number(countRows[0]?.count ?? 0) === 0) await seedUniversalQuestionnaire()
      return
    } catch (error) {
      lastError = error
      if (!isDbConnectError(error) || attempt === 3) break
      await sleep(700 * attempt)
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `Could not reach the Neon database. Wake the project in the Neon dashboard if it is paused, check your internet, and confirm DATABASE_URL in .env.local. (${detail})`
  )
}

async function runMigrations(db: NeonQueryFunction<false, false>): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS questionnaires (
      id TEXT PRIMARY KEY,
      is_default BOOLEAN NOT NULL DEFAULT false,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      theme_preset TEXT NOT NULL DEFAULT 'light',
      theme_heading TEXT NOT NULL DEFAULT 'large',
      theme_width TEXT NOT NULL DEFAULT 'wide',
      theme_progress TEXT NOT NULL DEFAULT 'fraction',
      theme_show_logo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      sort_order INT NOT NULL,
      question TEXT NOT NULL,
      help_text TEXT NOT NULL DEFAULT '',
      placeholder TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      options JSONB NOT NULL DEFAULT '[]',
      logic JSONB,
      role TEXT
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'new',
      name TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      project_type TEXT NOT NULL DEFAULT '',
      clarity INT NOT NULL DEFAULT 0,
      answers JSONB NOT NULL DEFAULT '{}',
      snapshot JSONB NOT NULL DEFAULT '{}',
      ready JSONB NOT NULL DEFAULT '[]',
      clarify JSONB NOT NULL DEFAULT '[]'
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS workspace (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'Appsrow Discovery',
      domain TEXT NOT NULL DEFAULT 'discover.appsrow.com',
      default_theme TEXT NOT NULL DEFAULT 'light'
    )
  `
  await db`INSERT INTO workspace (id) VALUES (1) ON CONFLICT DO NOTHING`
  await db`ALTER TABLE workspace ADD COLUMN IF NOT EXISTS admin_email TEXT NOT NULL DEFAULT ''`
  await db`ALTER TABLE workspace ADD COLUMN IF NOT EXISTS notify_on_submit BOOLEAN NOT NULL DEFAULT true`
  await db`ALTER TABLE questions ADD COLUMN IF NOT EXISTS role TEXT`
  await db`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questionnaire_id TEXT NOT NULL DEFAULT ''`
  await db`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'`


  // Ensure indexes exist
  await db`CREATE INDEX IF NOT EXISTS sections_questionnaire_idx ON sections (questionnaire_id, sort_order)`
  await db`CREATE INDEX IF NOT EXISTS questions_section_idx ON questions (section_id, sort_order)`
  await db`CREATE INDEX IF NOT EXISTS submissions_questionnaire_idx ON submissions (questionnaire_id, created_at DESC)`
  await db`CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions (created_at DESC)`
}

async function seedUniversalQuestionnaire(): Promise<void> {
  const sections: SectionData[] = [
    { id: 'about', title: 'About you', order: 1, questions: [
      { id: 'q_email', sectionId: 'about', type: 'email', question: 'What is your work email?', helpText: "We'll use this only for project communication.", placeholder: 'you@company.com', required: true, active: true, options: [], role: 'email', order: 1 },
      { id: 'q_name', sectionId: 'about', type: 'short_text', question: 'What is your full name?', helpText: '', placeholder: 'Your name', required: true, active: true, options: [], role: 'full_name', order: 2 },
      { id: 'q_company', sectionId: 'about', type: 'short_text', question: 'What is your company name?', helpText: '', placeholder: 'Company name', required: true, active: true, options: [], role: 'company', order: 3 },
    ]},
    { id: 'project', title: 'Project direction', order: 2, questions: [
      { id: 'q_project_type', sectionId: 'project', type: 'single_select', question: 'What are you primarily looking for help with?', helpText: 'Choose the option closest to your current requirement.', placeholder: '', required: true, active: true, options: ['Website design + development', 'Webflow development', 'Website redesign', 'Migration to Webflow', 'SEO / AEO', 'Maintenance / support'], role: 'project_type', order: 1 },
      { id: 'q_goal', sectionId: 'project', type: 'long_text', question: 'What is the main goal of this project?', helpText: 'Tell us what should change for the business once this project succeeds.', placeholder: 'Describe the outcome you want...', required: true, active: true, options: [], order: 2 },
      { id: 'q_audience', sectionId: 'project', type: 'long_text', question: 'Who is the primary target audience?', helpText: 'Company type, role, customer segment and any useful context.', placeholder: 'Describe the audience...', required: true, active: true, options: [], order: 3 },
      { id: 'q_geo', sectionId: 'project', type: 'long_text', question: 'Which geographies or markets matter most?', helpText: 'Countries, regions, cities or global markets.', placeholder: 'US, UK, Europe...', required: true, active: true, options: [], order: 4 },
    ]},
    { id: 'scope', title: 'Website scope', order: 3, questions: [
      { id: 'q_sitemap', sectionId: 'scope', type: 'single_select', question: 'Is the sitemap ready?', helpText: 'If it is ready or mostly ready, we will ask for the file or link next.', placeholder: '', required: true, active: true, options: ['Yes', 'Mostly ready', 'No'], order: 1 },
      { id: 'q_sitemap_link', sectionId: 'scope', type: 'file_url', question: 'Please share the sitemap.', helpText: 'Upload it or paste a link.', placeholder: 'https://...', required: true, active: true, options: [], logic: { showWhen: { match: 'any', conditions: [{ questionId: 'q_sitemap', operator: 'equals', value: 'Yes' }, { questionId: 'q_sitemap', operator: 'equals', value: 'Mostly ready' }] } }, order: 2 },
    ]},
    { id: 'design', title: 'Design readiness', order: 4, questions: [
      { id: 'q_design_status', sectionId: 'design', type: 'single_select', question: 'What is the current design status?', helpText: '', placeholder: '', required: true, active: true, options: ['No designs yet', 'Partially ready', 'Finalized in Figma'], order: 1 },
      { id: 'q_figma', sectionId: 'design', type: 'url', question: 'Please share the Figma/design link.', helpText: 'Share the latest design file your team wants us to review.', placeholder: 'https://figma.com/...', required: true, active: true, options: [], logic: { showWhen: { match: 'any', conditions: [{ questionId: 'q_design_status', operator: 'equals', value: 'Partially ready' }, { questionId: 'q_design_status', operator: 'equals', value: 'Finalized in Figma' }] } }, order: 2 },
    ]},
  ]

  await createQuestionnaire({
    name: 'Universal Discovery',
    slug: 'appsrow',
    purpose: 'The main Appsrow intake for incoming leads across design, Webflow, migration, SEO/AEO, maintenance, branding and agency partnerships.',
    status: 'live',
    isDefault: true,
    sections,
  })
}
