// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call or a
// permission check inside a call; these functions are what the hooks apply).
import type {
  AgentCard,
  Architect,
  Bucket,
  Check,
  Gate,
  Layout,
  LogLine,
  Loop,
  Main,
  Moment,
  Receipt,
  Roster,
  Tally,
  ToolNote,
  Turn,
  Usage,
  View,
} from '../types'

export const SCHEMA_VERSION = 2

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false }
export const DEFAULT_USAGE: Usage = {
  pct: null,
  tokens: null,
  window: 0,
  costUsd: null,
  limits: [],
  compactions: 0,
  lastCompactAt: null,
}
export const DEFAULT_ARCHITECT: Architect = { consults: [], ids: [], seen: [], lastAdvice: '' }
const ZERO: Tally = { rule: 0, ask: 0, cleared: 0, deny: 0 }
export const DEFAULT_GATE: Gate = { recent: [], totals: { file: ZERO, shell: ZERO, other: ZERO } }
export const DEFAULT_TURN: Turn = { edits: 0, errorStreak: 0, errors: 0, isReviewing: false, startedAt: 0, costAtStart: null }
export const DEFAULT_VIEW: View = { expanded: null, gateOpen: null, layout: null }
export const DEFAULT_ROSTER: Roster = { architectTypes: [] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const normalizeGate = (stored: unknown): Gate => {
  const g = normalize(DEFAULT_GATE, stored)
  const totals = normalize(DEFAULT_GATE.totals, g.totals)
  return {
    recent: listOf<Check>(g.recent),
    totals: { file: normalize(ZERO, totals.file), shell: normalize(ZERO, totals.shell), other: normalize(ZERO, totals.other) },
  }
}

export const normalizeCard = (stored: unknown): AgentCard => {
  const c = normalize<AgentCard>(
    {
      id: '',
      parentId: null,
      type: 'agent',
      model: '',
      description: '',
      status: 'running',
      spawnedAt: 0,
      endedAt: null,
      ctx: 0,
      out: 0,
      steps: 0,
      lastStop: null,
      tools: [],
      answer: '',
    },
    stored,
  )
  // A card saved before parents were kept reads as spawned by the main loop.
  return typeof c.parentId === 'string' ? c : { ...c, parentId: null }
}

export const normalizeLog = (stored: unknown): LogLine[] =>
  listOf<Record<string, unknown>>(stored).map(l => ({
    at: typeof l.at === 'number' ? l.at : 0,
    who: String(l.who ?? ''),
    text: String(l.text ?? ''),
    agentId: typeof l.agentId === 'string' ? l.agentId : null,
    kind: l.kind === 'error' || l.kind === 'consult' || l.kind === 'done' ? l.kind : 'info',
  }))

// ---------------------------------------------------------------- config

export type Panel = 'main' | 'architect' | 'gate' | 'agents' | 'loops' | 'receipt' | 'log'
const PANELS: readonly Panel[] = ['main', 'architect', 'gate', 'agents', 'loops', 'receipt', 'log']

export type Config = {
  architect: RegExp
  architectLabel: string
  gateLabel: string
  panels: Panel[]
  motion: boolean
  moments: boolean
  matchDescriptions: boolean
  maxCards: number
  layout: Layout
  palette: Palette
  openOnStart: boolean
  statusLine: boolean
  mascot: boolean
  cost: boolean
}

const safeRegExp = (source: string, fallback: string) => {
  try {
    return new RegExp(source || fallback, 'i')
  } catch {
    return new RegExp(fallback, 'i')
  }
}

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const panels = str('panels', PANELS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter((p): p is Panel => (PANELS as readonly string[]).includes(p))
  const layout = str('layout', 'auto')
  const max = typeof o.maxCards === 'number' ? Math.round(o.maxCards) : 3
  return {
    architect: safeRegExp(str('architectPattern', ''), 'advisor|architect'),
    architectLabel: str('architectLabel', 'ARCHITECT'),
    gateLabel: str('gateLabel', 'GATE'),
    panels: panels.length > 0 ? [...new Set(panels)] : [...PANELS],
    motion: str('motion', 'while-active') !== 'off',
    moments: bool('moments', true),
    matchDescriptions: bool('matchDescriptions', false),
    maxCards: Math.min(6, Math.max(1, max)),
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    openOnStart: bool('openOnStart', true),
    statusLine: bool('statusLine', true),
    mascot: str('mascot', 'on') !== 'off',
    cost: str('cost', 'off') === 'on',
  }
}

// ---------------------------------------------------------------- palette

export type Palette = 'theme' | 'pastel'
export type Colors = Record<'main' | 'agent' | 'gate' | 'cleared' | 'arch' | 'amber' | 'warn' | 'dim' | 'faint' | 'text', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals.
 */
export const PALETTES: Record<Palette, Colors> = {
  theme: {
    main: 'claude',
    agent: 'suggestion',
    gate: 'success',
    cleared: 'permission',
    arch: 'merged',
    amber: 'warning',
    warn: 'error',
    dim: 'inactive',
    faint: 'subtle',
    text: 'text',
  },
  pastel: {
    main: '#7dd3fc',
    agent: '#93c5fd',
    gate: '#86efac',
    cleared: '#5eead4',
    arch: '#c4b5fd',
    amber: '#fcd34d',
    warn: '#fca5a5',
    dim: '#6b7280',
    faint: '#3f4654',
    text: '#e5e7eb',
  },
}

/** SVG cannot name theme keys: mid-tone colours that read on light and dark backgrounds. */
export const SVG_COLORS = { running: '#3b82f6', done: '#16a34a', failed: '#dc2626', other: '#8b5cf6', label: '#6b7280' }

// ---------------------------------------------------------------- formatting

/** `claude-opus-5-5` → `Opus 5.5`; anything else is shown as given. */
/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`, `claude-3-5-haiku-20241022` →
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

export const kTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A running clock as the live cards draw it: m:ss, or XhYY past an hour. */
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtClock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')

/** `1 error`, `2 errors`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/** A gauge of `width` cells: ▰ filled, ▱ empty. */
export const gauge = (pct: number, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

/** A rate-limit window's short name: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
export const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

// ---------------------------------------------------------------- redaction

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** What the gate drill-down may store: credentials masked before anything is written to state. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// ---------------------------------------------------------------- tools and gate

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const bucketOf = (tool: string): Bucket =>
  FILE_TOOLS.has(tool) ? 'file' : SHELL_TOOLS.has(tool) ? 'shell' : 'other'

/** One line saying what a call was about: its command, path or pattern; redacted. */
export const describeInput = (tool: string, input: unknown) => {
  const i = isObject(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what =
    typeof i.command === 'string'
      ? i.command
      : path || (typeof i.pattern === 'string' ? i.pattern : typeof i.url === 'string' ? i.url : typeof i.description === 'string' ? i.description : '')
  return redact(what ? `${tool} → ${what}` : tool)
}

/** Keeps the last `max` checks, but never drops a pending ask: its settle must still find it. */
export const trimRecent = (list: Check[], max: number): Check[] => {
  let extra = list.length - max
  if (extra <= 0) return list
  const out: Check[] = []
  for (const c of list) {
    if (extra > 0 && c.verdict !== 'ask') {
      extra -= 1
      continue
    }
    out.push(c)
  }
  return out.slice(-max * 2)
}

export const recordCheck = (g: Gate, c: Check): Gate => {
  const t = g.totals[c.bucket]
  return {
    recent: trimRecent([...g.recent, c], 80),
    totals: { ...g.totals, [c.bucket]: { ...t, [c.verdict]: t[c.verdict] + 1 } },
  }
}

/** An `ask` settled by the call that followed it: it ran (cleared) or was refused (deny). */
export const settleCheck = (g: Gate, id: string, didRun: boolean): Gate => {
  const c = g.recent.find(r => r.id === id && r.verdict === 'ask')
  if (!c) return g
  const verdict = didRun ? 'cleared' : 'deny'
  const t = g.totals[c.bucket]
  return {
    recent: g.recent.map(r => (r === c ? { ...r, verdict } : r)),
    totals: { ...g.totals, [c.bucket]: { ...t, ask: Math.max(0, t.ask - 1), [verdict]: t[verdict] + 1 } },
  }
}

export const gateSummary = (g: Gate) => {
  const all = (['file', 'shell', 'other'] as const).reduce(
    (s, k) => ({
      rule: s.rule + g.totals[k].rule,
      ask: s.ask + g.totals[k].ask,
      cleared: s.cleared + g.totals[k].cleared,
      deny: s.deny + g.totals[k].deny,
    }),
    { ...ZERO },
  )
  return { ...all, total: all.rule + all.ask + all.cleared + all.deny }
}

// ---------------------------------------------------------------- turn and architect

/**
 * The turn after one tool call. Errors count in the main loop only (a subagent's failure is its
 * own); edits count from every loop, so delegated work still reaches "before done".
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

/** Which of the architect's three moments a consult falls at: an inference over this turn so far. */
export const momentOf = (t: Pick<Turn, 'edits' | 'errorStreak'>): Moment =>
  t.errorStreak >= 2 ? 'error repeats' : t.edits === 0 ? 'before a plan' : 'before done'

export const startConsult = (a: Architect, c: { id: string; at: number; moment: Moment; via: string }): Architect =>
  a.consults.some(x => x.id === c.id) ? a : { ...a, consults: [...a.consults, { ...c, endAt: null }].slice(-40) }

/** Ends the open consult (the latest without an end), or the one named. */
export const endConsult = (a: Architect, at: number, advice: string | null, id?: string): Architect => {
  const open = [...a.consults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  return {
    ...a,
    consults: a.consults.map(c => (c === open ? { ...c, endAt: at } : c)),
    lastAdvice: advice ?? a.lastAdvice,
  }
}

export const isAdvising = (a: Architect) => a.consults.some(c => c.endAt === null)

/** A one-row timeline of consults across `width` cells: ◆ a consult, ━ while it ran. */
export const consultTimeline = (a: Architect, now: number, width: number) => {
  if (a.consults.length === 0 || width < 4) return '─'.repeat(Math.max(0, width))
  const first = a.consults[0]?.at ?? now
  const span = Math.max(1, now - first)
  const cells = Array.from({ length: width }, () => '─')
  for (const c of a.consults) {
    const from = Math.min(width - 1, Math.floor(((c.at - first) / span) * (width - 1)))
    const to = Math.min(width - 1, Math.floor((((c.endAt ?? now) - first) / span) * (width - 1)))
    for (let i = from + 1; i <= to; i += 1) cells[i] = '━'
    cells[from] = '◆'
  }
  return cells.join('')
}

export const receiptOf = (t: Turn, o: { durationMs: number; agentsSince: number; costNow: number | null; reason: string }): Receipt => ({
  durationMs: o.durationMs,
  agents: o.agentsSince,
  edits: t.edits,
  errors: t.errors,
  costDelta: o.costNow !== null && t.costAtStart !== null && o.costNow - t.costAtStart >= 0.005 ? o.costNow - t.costAtStart : null,
  reason: o.reason,
})

// ---------------------------------------------------------------- agents and loops

type StepUsage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | null

/** A card after one of its model requests: its context is the latest step's whole input; output adds up. */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...c,
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    out: c.out + (u.output_tokens ?? 0),
    lastStop: s.stopReason,
  }
}

export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({ ...c, tools: [...c.tools, n].slice(-3) })

export const stepLoop = (loops: Loop[], id: string, at: number): Loop[] => {
  const found = loops.find(l => l.id === id)
  const next = found
    ? loops.map(l => (l === found ? { ...l, steps: l.steps + 1, lastAt: at } : l))
    : [...loops, { id, steps: 1, firstAt: at, lastAt: at, isDone: false }]
  return next.slice(-60)
}

export const LOOP_ACTIVE_MS = 15_000
export const isLoopActive = (l: Loop, now: number) => !l.isDone && now - l.lastAt < LOOP_ACTIVE_MS

/** The desktop time axis: each agent's bar on one shared axis from the first spawn to now. */
export const timeBars = (cards: AgentCard[], now: number, width: number) => {
  const start = Math.min(...cards.map(c => c.spawnedAt).filter(n => n > 0), now)
  const span = Math.max(1, now - start)
  return cards.map(c => {
    const from = Math.floor(((Math.max(c.spawnedAt, start) - start) / span) * width)
    const to = Math.max(from + 1, Math.ceil((((c.endedAt ?? now) - start) / span) * width))
    return { id: c.id, before: Math.min(from, width), bar: Math.min(to, width) - Math.min(from, width), after: width - Math.min(to, width) }
  })
}

// ---------------------------------------------------------------- layout

/** Rows one agent card takes in the list: its two borders, the title, type and model, tokens and status. */
export const CARD_ROWS = 6

/** Cards kept in state, the oldest dropped past it; the list draws every one. */
export const MAX_CARDS = 24

/** Rows the agents section takes: its frame and title, then each card; nothing without a card. */
export const agentsRows = (cards: number) => (cards > 0 ? 3 + CARD_ROWS * Math.min(cards, MAX_CARDS) : 0)

/** How many log lines fit: what the other panels leave, never fewer than 4 nor more than 8. */
export const logRows = (bodyRows: number, used: number) => Math.max(4, Math.min(8, bodyRows - used - 3))

/** Legend items that fit on one row of `width` cells, in order; the rest are dropped. */
export const fitLegend = <T extends { label: string }>(items: T[], width: number) => {
  const out: T[] = []
  let used = 0
  for (const it of items) {
    const w = it.label.length + 4
    if (used + w > width) break
    out.push(it)
    used += w
  }
  return out
}

/** A card's title row: the task in the agent's own words, the type only when there is none. */
export const cardTitle = (c: AgentCard) => c.description || c.type

/** A model as a card names it: its family (`opus`, `sonnet`, `haiku`), or any other model as `prettyModel` does. */
export const shortModel = (id: string) => /(opus|sonnet|haiku)/i.exec(id)?.[1]?.toLowerCase() ?? prettyModel(id)

/**
 * A card's second row: its type and model, always; then, for a sub-agent, `↳` and its parent's
 * title when at least 6 cells of it fit in `width`. Otherwise the parent waits for the expanded card.
 */
export const cardKind = (c: AgentCard, parent: AgentCard | null, width: number) => {
  const base = `${c.type} · ${shortModel(c.model)}`
  const room = width - base.length - 5
  return parent && room >= 6 ? `${base} · ↳ ${shorten(cardTitle(parent), room)}` : base
}

/** A card's third row: its context, its output and its steps, or `starting…` before its first step. */
export const cardStats = (c: AgentCard) =>
  c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${plural(c.steps, 'step')}` : 'starting…'

export type TreeRow = { card: AgentCard; depth: number; prefix: string; parent: AgentCard | null }

/**
 * Cards as a tree: each child right after its parent and the parent's earlier children, spawn
 * order kept among siblings. The main loop is the root: `prefix` is the branch drawn before the
 * title, `├─` or, for the last child of its parent, `└─`, under `│ ` or `  ` for each level
 * above, the main loop's level included. A card whose parent has no card here (an architect, a
 * card evicted or not shown) is drawn at the top level, as the main loop's children are.
 */
export const agentTree = (cards: AgentCard[]): TreeRow[] => {
  const byId = new Map<string, AgentCard>()
  for (const c of cards) if (!byId.has(c.id)) byId.set(c.id, c)
  const kids = new Map<string | null, AgentCard[]>()
  for (const c of cards) {
    const key = c.parentId !== null && c.parentId !== c.id && byId.has(c.parentId) ? c.parentId : null
    kids.set(key, [...(kids.get(key) ?? []), c])
  }
  // First the shape (who sits under whom), then the drawing: a branch needs to know it is the last.
  type Node = { card: AgentCard; parent: AgentCard | null; below: Node[] }
  const seen = new Set<AgentCard>()
  const grow = (c: AgentCard, parent: AgentCard | null): Node => {
    seen.add(c)
    const below: Node[] = []
    for (const k of kids.get(c.id) ?? []) if (!seen.has(k)) below.push(grow(k, c))
    return { card: c, parent, below }
  }
  const roots: Node[] = []
  for (const c of kids.get(null) ?? []) if (!seen.has(c)) roots.push(grow(c, null))
  // Only a loop in the links (which spawning cannot make) leaves cards unreached: draw them at the top.
  for (const c of cards) if (!seen.has(c)) roots.push(grow(c, null))
  const out: TreeRow[] = []
  const draw = (n: Node, depth: number, lead: string, isLast: boolean) => {
    out.push({ card: n.card, depth, prefix: `${lead}${isLast ? '└─' : '├─'}`, parent: n.parent })
    n.below.forEach((k, i) => draw(k, depth + 1, `${lead}${isLast ? '  ' : '│ '}`, i === n.below.length - 1))
  }
  roots.forEach((r, i) => draw(r, 0, '', i === roots.length - 1))
  return out
}

/** One row of the lanes' trunk column: its branch glyphs, and which of its cells lead to a running agent. */
export type SpineRow = { prefix: string; active: boolean; flow: boolean[] }

/** The trunk column's widest branch: the trunk, one level and the agent's own branch. */
export const SPINE_MAX = 6

/**
 * The lanes' trunk column, one row per line beside it: every prefix cut to `SPINE_MAX` cells
 * (keeping the trunk and the agent's own branch, dropping the levels between) and padded to one
 * width, so the axis beside it starts on the same cell on every row. `flow` marks the cells on the
 * way from the header to each running agent: up its own branch, then each ancestor's line and
 * branch, to the trunk. A row with no branch of its own (the "+N earlier" line) only carries the trunk.
 */
export const spineRows = (input: { prefix: string; active: boolean }[]): { rows: SpineRow[]; width: number } => {
  const cut = input.map(r => (r.prefix.length > SPINE_MAX ? r.prefix.slice(0, SPINE_MAX - 2) + r.prefix.slice(-2) : r.prefix))
  const width = Math.max(0, ...cut.map(p => p.length))
  const cells = cut.map(p => Array.from(p.padEnd(width)))
  const flow = cells.map(row => row.map(() => false))
  const at = (r: number, x: number) => cells[r]?.[x] ?? ' '
  const mark = (r: number, x: number) => {
    const row = flow[r]
    if (row && at(r, x) !== ' ') row[x] = true
  }
  input.forEach((r, i) => {
    if (!r.active) return
    const line = cells[i] ?? []
    const conn = Math.max(line.lastIndexOf('├'), line.lastIndexOf('└'))
    if (conn < 0) return
    for (let x = conn; x < width; x += 1) mark(i, x)
    let x = conn
    let row = i - 1
    while (row >= 0 && x >= 0) {
      const ch = at(row, x)
      if (ch === '│' || ch === '├' || ch === '└') {
        mark(row, x)
        row -= 1
        continue
      }
      // The parent's row: its branch sits one level to the left; climb on from its connector.
      x -= 2
      if (x < 0) break
      mark(row, x)
      mark(row, x + 1)
      row -= 1
    }
  })
  return { rows: cut.map((p, i) => ({ prefix: p.padEnd(width), active: input[i]?.active ?? false, flow: flow[i] ?? [] })), width }
}

/** Levels the cards' trunk draws apart: 0 (the main loop's agents), 1 and 2; deeper ones share level 2's column. */
const SPINE_LEVELS = (SPINE_MAX - 2) / 2

/**
 * The cards' trunk column: `height` rows beside each card, in the tree's order, all one width.
 * A card's branch (`├─`, the last one at its level `└─`) is on its top row and runs on in `─` to
 * the card; a card with children drops a `┬` there, and their line runs down beside it. A line
 * goes on down while a later card hangs at its column before a shallower one. Past level 2, cards
 * are drawn at level 2 with their own branch. `flow` marks the cells on the way from the top to
 * each running card: up its own line, through each ancestor's `┬` and branch, to the trunk.
 */
export const cardSpine = (input: { depth: number; active: boolean }[], height = CARD_ROWS): { rows: SpineRow[]; width: number } => {
  const lv = input.map(r => Math.max(0, Math.min(SPINE_LEVELS, r.depth)))
  const width = lv.length > 0 ? 2 * Math.max(...lv) + 2 : 0
  const goesOn = lv.map((l, i) => {
    for (const next of lv.slice(i + 1)) if (next <= l) return next === l
    return false
  })
  // Which levels' lines are still open at the card being drawn: its ancestors' (the latest card at each level above).
  const open: boolean[] = []
  const lines: string[] = []
  lv.forEach((l, i) => {
    const on = goesOn[i] ?? false
    const kids = l < SPINE_LEVELS && lv[i + 1] === l + 1
    const lead = Array.from({ length: l }, (_, k) => (open[k] ? '│ ' : '  ')).join('')
    lines.push(`${lead}${on ? '├' : '└'}─${kids ? '┬' : ''}`.padEnd(width, '─'))
    const below = `${lead}${on ? '│' : ' '} ${kids ? '│' : ''}`.padEnd(width)
    for (let k = 1; k < height; k += 1) lines.push(below)
    open[l] = on
  })
  const cells = lines.map(p => Array.from(p))
  const flow = cells.map(row => row.map(() => false))
  const at = (r: number, x: number) => cells[r]?.[x] ?? ' '
  const mark = (r: number, x: number) => {
    const row = flow[r]
    if (row && at(r, x) !== ' ') row[x] = true
  }
  input.forEach((r, i) => {
    if (!r.active) return
    const top = i * height
    let x = 2 * (lv[i] ?? 0)
    for (let c = x; c < width; c += 1) mark(top, c)
    let row = top - 1
    while (row >= 0 && x >= 0) {
      const ch = at(row, x)
      if (ch === '┬') {
        // A parent's top row: across its branch to its own line, and up that.
        mark(row, x)
        mark(row, x - 1)
        mark(row, x - 2)
        x -= 2
      } else if (ch === '│' || ch === '├') mark(row, x)
      else break
      row -= 1
    }
  })
  return { rows: lines.map((p, k) => ({ prefix: p, active: input[Math.floor(k / Math.max(1, height))]?.active ?? false, flow: flow[k] ?? [] })), width }
}

// ---------------------------------------------------------------- Clawd

/** One run of Clawd's glyphs: plain body, `eyes` (body on the eye colour), or a `lid` (eye colour on body). */
export type ClawdSpan = { text: string; on?: 'eyes' | 'lid' }
export type ClawdPose = 'default' | 'armsUp' | 'blink' | 'wink'

/** Clawd's colours as Claude Code paints him: the `claude` orange, black eyes. */
export const CLAWD_COLORS = { body: '#D77757', eyes: '#000000' }

const clawd = (arms: 'down' | 'up', eyes: ClawdSpan[]): ClawdSpan[][] => [
  [{ text: arms === 'up' ? '▗▟' : ' ▐' }, ...eyes, ...(arms === 'up' ? [{ text: '▄' }] : [])],
  [{ text: arms === 'up' ? ' ▜' : '▝▜' }, { text: '█████', on: 'eyes' }, { text: arms === 'up' ? '█▘' : '█▀' }],
  [{ text: ' ▝▝   ▝▝ ' }],
]

/**
 * Clawd, 3 rows of at most 9 cells, glyph for glyph as Claude Code's own welcome draws him: arms
 * down or up, eyes open, closed (two lids) or winking (one lid).
 */
export const CLAWD: Record<ClawdPose, ClawdSpan[][]> = {
  default: clawd('down', [{ text: '▛███▛█', on: 'eyes' }]),
  armsUp: clawd('up', [{ text: '▛███▛█', on: 'eyes' }]),
  blink: clawd('down', [{ text: '▂', on: 'lid' }, { text: '███', on: 'eyes' }, { text: '▂', on: 'lid' }, { text: '█', on: 'eyes' }]),
  wink: clawd('up', [{ text: '▛███', on: 'eyes' }, { text: '▂', on: 'lid' }, { text: '█', on: 'eyes' }]),
}

/** Who spawned a card, by its real parent id: `main`, the parent card's title, the architect, or `agent`. */
export const parentLabel = (c: AgentCard, cards: AgentCard[], architectIds: string[], architectName: string) => {
  if (c.parentId === null) return 'main'
  const parent = cards.find(x => x.id === c.parentId)
  if (parent) return cardTitle(parent)
  return architectIds.includes(c.parentId) ? architectName : 'agent'
}

/** A title split over two rows at a word boundary: `first` cells on row one, `rest` on row two. */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= first) return [t, '']
  const cut = t.lastIndexOf(' ', first)
  const at = cut > 0 ? cut : first
  return [t.slice(0, at).trim(), shorten(t.slice(at), rest)]
}

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 */
export const promptLine = (text: string): { who: string; text: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(text, 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  return { who: 'engine', text: shorten(`${tag.replace(/[-_]/g, ' ')}${from ? ` from ${from.slice(0, 8)}` : ''}`, 70) }
}

/**
 * A subagent's hand-back message: who sent it and the first line of what it said. The report
 * follows a framing header in the message; without one, the first line after the opening tag.
 */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const afterHeader = text.split(/The report follows:\s*\n/)[1]
  const rest = afterHeader ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body =
    rest
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('</')) ?? ''
  return body ? { from, body } : null
}

/** The advice line a pane shows for a report: its first real line, markdown markers stripped, cut to 160. */
export const adviceLine = (report: string) => {
  const first = report.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return shorten(first.replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, ''), 160)
}

export const elapsedOf = (c: AgentCard, now: number) => (c.endedAt ?? now) - c.spawnedAt
