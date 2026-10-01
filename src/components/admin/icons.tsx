export function Icon({ name, className = '' }: { name: string; className?: string }) {
  const d: Record<string, string> = {
    overview: 'M4 13h6V4H4v9zm10 7h6V4h-6v16zM4 20h6v-5H4v5z',
    form: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    inbox: 'M4 6h16v12H4V6zm0 6h16',
    template: 'M4 5h16v14H4V5zm4 4h8M8 13h5',
    settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8 4h-2M6 12H4m12.5-6.5l-1.4 1.4M8.9 15.1l-1.4 1.4m0-9.2l1.4 1.4M15.1 15.1l1.4 1.4',
    code: 'M8 8l-4 4 4 4M16 8l4 4-4 4',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zm6-3l4 4',
    plus: 'M12 5v14M5 12h14',
    copy: 'M8 8h10v12H8V8zm-3 3V4h10',
    share: 'M4 12v8h16v-8M12 16V4m0 0l-4 4m4-4l4 4',
    more: 'M12 6h.01M12 12h.01M12 18h.01',
    trash: 'M5 7h14M9 7V5h6v2m-8 0l1 12h8l1-12',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
    download: 'M12 4v12m0 0l-4-4m4 4l4-4M5 20h14',
    lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6v-9z',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
    bell: 'M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM10 20h4',
    palette: 'M12 4a8 8 0 108 8c0-2-2-2-3-2a3 3 0 01-3-3c0-1 0-3 2-3',
    upload: 'M12 20V8m0 0l-4 4m4-4l4 4M5 20h14',
    star: 'M12 3l2.4 6.6H21l-5.4 4.2 2 6.2L12 16.6 6.4 20l2-6.2L3 9.6h6.6z',
    chevron: 'M8 10l4 4 4-4',
    'arrow-left': 'M15 19l-7-7 7-7',
    check: 'M5 12l5 5L20 7',
    key: 'M8 15a4 4 0 110-8 4 4 0 010 8zm4-4h9v3h-2v2h-2v-2h-2',
    monitor: 'M3 5h18v12H3V5zm4 16h10',
    phone: 'M8 3h8v18H8V3zm4 15h.01',
  }
  return (
    <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d[name] || d.form} />
    </svg>
  )
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AR'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'AR'
}

export function statusClass(status: string): string {
  if (status === 'live' || status === 'reviewed') return 'live'
  if (status === 'new') return 'new'
  if (status === 'closed' || status === 'incomplete') return 'warn'
  if (status === 'archived') return 'archived'
  if (status === 'trash') return 'trash'
  return 'draft'
}
