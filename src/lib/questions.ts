export type QuestionType =
  | 'email'
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'url'
  | 'file_upload'
  | 'file_url'
  | 'number'
  | 'date'

export type QuestionRole = 'full_name' | 'email' | 'company' | 'relationship' | 'project_type'

export type ShowOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_answered'
  | 'is_not_answered'
  | 'greater_than'
  | 'less_than'

export type ShowCondition = {
  questionId: string
  operator: ShowOperator
  value?: string
}

export type ShowWhen = {
  match: 'any' | 'all'
  conditions: ShowCondition[]
}

export type Logic = {
  showWhen: ShowWhen
}

export type AnswerValue = string | string[]
export type Answers = Record<string, AnswerValue>

export type QuestionOption = { label: string; value: string } | string

export type QuestionData = {
  id: string
  sectionId: string
  type: QuestionType
  question: string
  helpText: string
  placeholder: string
  required: boolean
  active: boolean
  options: string[]
  logic?: Logic
  role?: QuestionRole | null
  order: number
}

export type SectionData = {
  id: string
  title: string
  order: number
  collapsed?: boolean
  questions: QuestionData[]
}

export type ThemePreset = 'light' | 'dark' | 'editorial'
export type HeadingScale = 'large' | 'compact'
export type ContentWidth = 'wide' | 'focused'
export type ProgressStyle = 'fraction' | 'minimal'

export type ThemeSettings = {
  preset: ThemePreset
  heading: HeadingScale
  width: ContentWidth
  progress: ProgressStyle
  showLogo: boolean
}

export type QuestionnaireStatus = 'draft' | 'live' | 'closed' | 'archived' | 'trash'

export type QuestionnaireData = {
  id: string
  isDefault: boolean
  name: string
  slug: string
  purpose: string
  status: QuestionnaireStatus
  createdAt: string
  updatedAt: string
  theme: ThemeSettings
  sections: SectionData[]
}

export type ResponseData = {
  id: string
  questionnaireId: string
  questionnaireName?: string
  name: string
  company: string
  email: string
  status: 'new' | 'reviewed' | 'incomplete' | 'archived' | 'trash'
  clarity: number
  submittedAt: string
  createdAt: string
  projectType: string
  snapshot: Record<string, string>
  ready: string[]
  clarify: string[]
  answers: [string, string][]
  notes: ResponseNote[]
}

export type ResponseNote = {
  id: string
  author: string
  time: string
  body: string
}

export type WorkspaceSettings = {
  name: string
  domain: string
  defaultTheme: ThemePreset
  adminEmail: string
  notifyOnSubmit: boolean
}

export const SUPPORTED_TYPES: QuestionType[] = [
  'email', 'short_text', 'long_text', 'single_select', 'multi_select',
  'url', 'file_upload', 'file_url', 'number', 'date',
]

export const OPERATORS: ShowOperator[] = [
  'equals', 'not_equals', 'contains', 'not_contains',
  'is_answered', 'is_not_answered', 'greater_than', 'less_than',
]

export const TYPE_LABELS: Record<QuestionType, string> = {
  email: 'Email',
  short_text: 'Short text',
  long_text: 'Long text',
  single_select: 'Single select',
  multi_select: 'Multi select',
  url: 'URL',
  file_upload: 'File upload',
  file_url: 'File / URL',
  number: 'Number',
  date: 'Date',
}

export const QUESTION_ROLES: QuestionRole[] = ['full_name', 'email', 'company', 'project_type', 'relationship']

export const ROLE_LABELS: Record<QuestionRole, string> = {
  full_name: 'Full name',
  email: 'Email',
  company: 'Company',
  project_type: 'Project type',
  relationship: 'Relationship',
}

export function isChoiceType(type: QuestionType): boolean {
  return type === 'single_select' || type === 'multi_select'
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

export function uniqueSlug(desired: string, taken: string[]): string {
  const base = slugify(desired) || 'questionnaire'
  const used = new Set(taken.map((value) => value.replace(/^q\//, '')))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function cloneQuestionnaireSections(source: SectionData[]): SectionData[] {
  const idMap: Record<string, string> = {}
  const sections = source.map((section, sectionIndex) => {
    const newSid = uid('section')
    return {
      ...section,
      id: newSid,
      order: sectionIndex + 1,
      questions: section.questions.map((question, questionIndex) => {
        const newQid = uid('q')
        idMap[question.id] = newQid
        return { ...question, id: newQid, sectionId: newSid, order: questionIndex + 1 }
      }),
    }
  })
  return sections.map((section) => ({
    ...section,
    questions: section.questions.map((question) => {
      if (!question.logic?.showWhen?.conditions) return question
      return {
        ...question,
        logic: {
          showWhen: {
            ...question.logic.showWhen,
            conditions: question.logic.showWhen.conditions.map((condition) => ({
              ...condition,
              questionId: idMap[condition.questionId] || condition.questionId,
            })),
          },
        },
      }
    }),
  }))
}

export function getString(answers: Answers, id: string): string {
  const value = answers[id]
  return typeof value === 'string' ? value : ''
}

export function getArray(answers: Answers, id: string): string[] {
  const value = answers[id]
  return Array.isArray(value) ? value : []
}

export function isValueAnswered(value: AnswerValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && String(value).trim() !== ''
}

export function evaluateCondition(condition: ShowCondition, answers: Answers): boolean {
  const answered = isValueAnswered(answers[condition.questionId])
  const text = getString(answers, condition.questionId)

  switch (condition.operator) {
    case 'is_answered':
      return answered
    case 'is_not_answered':
      return !answered
    case 'equals':
      return answered && text === condition.value
    case 'not_equals':
      return answered && text !== condition.value
    case 'contains':
      return typeof condition.value === 'string' && text.toLowerCase().includes(condition.value.toLowerCase())
    case 'not_contains':
      return answered && typeof condition.value === 'string' && !text.toLowerCase().includes(condition.value.toLowerCase())
    case 'greater_than':
      return answered && Number(text) > Number(condition.value)
    case 'less_than':
      return answered && Number(text) < Number(condition.value)
    default:
      return false
  }
}

export function evaluateLogic(logic: Logic | undefined, answers: Answers): boolean {
  if (!logic?.showWhen?.conditions?.length) return true
  const { match, conditions } = logic.showWhen
  if (match === 'any') {
    return conditions.some((c) => evaluateCondition(c, answers))
  }
  return conditions.every((c) => evaluateCondition(c, answers))
}

export function getVisibleQuestions(questions: QuestionData[], answers: Answers): QuestionData[] {
  return questions.filter((q) => q.active && evaluateLogic(q.logic, answers))
}

export function formatAnswer(value: AnswerValue | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  return value
}

export function normalizeOption(o: QuestionOption): string {
  return typeof o === 'string' ? o : o.label
}

export function qCount(sections: SectionData[]): number {
  return sections.reduce((n, s) => n + s.questions.length, 0)
}

export function logicCount(sections: SectionData[]): number {
  return sections.reduce((n, s) => n + s.questions.filter((q) => q.logic?.showWhen?.conditions?.length).length, 0)
}
