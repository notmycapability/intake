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
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sections_questionnaire_idx ON sections (questionnaire_id, sort_order);

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
);

CREATE INDEX IF NOT EXISTS questions_section_idx ON questions (section_id, sort_order);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
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
  clarify JSONB NOT NULL DEFAULT '[]',
  notes JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS submissions_questionnaire_idx ON submissions (questionnaire_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions (created_at DESC);

-- Workspace settings (single row)
CREATE TABLE IF NOT EXISTS workspace (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Appsrow Discovery',
  domain TEXT NOT NULL DEFAULT 'discover.appsrow.com',
  default_theme TEXT NOT NULL DEFAULT 'light',
  admin_email TEXT NOT NULL DEFAULT '',
  notify_on_submit BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO workspace (id) VALUES (1) ON CONFLICT DO NOTHING;
