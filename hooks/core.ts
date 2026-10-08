// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call or a
// permission check inside a call; these functions are what the hooks apply).
import type {
  AgentCard,
  AgentFeed,
  Architect,
  Bucket,
  Check,
  FeedEntry,
  FeedTool,
  Gate,
  Layout,
  LogLine,
  Loop,
  Main,
  Moment,
  Receipt,
  ReviewVerdict,
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
export const DEFAULT_VIEW: View = { expanded: null, gateOpen: null, layout: null, agent: null, lane: null }
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

const VERDICTS: readonly unknown[] = ['BLOQUANT', 'MINEUR', 'OK']

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
      verdict: null,
      sent: 0,
      received: 0,
      lastMessageAt: null,
      lastMessageDir: null,
      notified: false,
      compactions: 0,
    },
    stored,
  )
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
  return {
    ...c,
    // A card saved before parents were kept reads as spawned by the main loop.
    parentId: typeof c.parentId === 'string' ? c.parentId : null,
    verdict: VERDICTS.includes(c.verdict) ? c.verdict : null,
    sent: count(c.sent),
    received: count(c.received),
    lastMessageAt: typeof c.lastMessageAt === 'number' ? c.lastMessageAt : null,
    lastMessageDir: c.lastMessageDir === 'in' || c.lastMessageDir === 'out' ? c.lastMessageDir : null,
    notified: c.notified === true,
    compactions: count(c.compactions),
  }
}

export const normalizeLog = (stored: unknown): LogLine[] =>
  listOf<Record<string, unknown>>(stored).map(l => ({
    at: typeof l.at === 'number' ? l.at : 0,
    who: String(l.who ?? ''),
    text: String(l.text ?? ''),
    agentId: typeof l.agentId === 'string' ? l.agentId : null,
    kind: l.kind === 'error' || l.kind === 'consult' || l.kind === 'done' || l.kind === 'message' ? l.kind : 'info',
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
  layout: Layout
  palette: Palette
  openOnStart: boolean
  statusLine: boolean
  mascot: boolean
  cost: boolean
  /** The agent tasks (their description) whose report carries a verdict to read. */
  verdict: RegExp
}

const safeRegExp = (source: string, fallback: string) => {
  try {
    return new RegExp(source || fallback, 'i')
  } catch {
    return new RegExp(fallback, 'i')
  }
}

/** The agent tasks whose report carries a verdict, by default: verify, review, check, audit. */
export const DEFAULT_VERDICT_PATTERN = 'v[ée]rif|verify|review|check|audit'

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const panels = str('panels', PANELS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter((p): p is Panel => (PANELS as readonly string[]).includes(p))
  const layout = str('layout', 'auto')
  return {
    architect: safeRegExp(str('architectPattern', ''), 'advisor|architect'),
    architectLabel: str('architectLabel', 'ARCHITECT'),
    gateLabel: str('gateLabel', 'GATE'),
    panels: panels.length > 0 ? [...new Set(panels)] : [...PANELS],
    motion: str('motion', 'while-active') !== 'off',
    moments: bool('moments', true),
    matchDescriptions: bool('matchDescriptions', false),
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    openOnStart: bool('openOnStart', true),
    statusLine: bool('statusLine', true),
    mascot: str('mascot', 'on') !== 'off',
    cost: str('cost', 'off') === 'on',
    verdict: safeRegExp(str('verdictPattern', ''), DEFAULT_VERDICT_PATTERN),
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

// Code points a terminal draws 2 cells wide: Hangul jamo, CJK, Hangul, compatibility and
// full-width forms, and emoji drawn as emoji by default (the pictographs and those in the BMP).
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693],
  [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]
// Code points drawn on the cell before them: combining marks, zero-width joiners and spaces, variation selectors.
const ZERO_WIDTH: [number, number][] = [[0x0300, 0x036f], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f]]
const within = (cp: number, ranges: [number, number][]) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi)

/** The cells a string takes in a terminal: 2 for a wide code point, 0 for a combining one, 1 otherwise. */
export const cellWidth = (s: string) => {
  let n = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    n += within(cp, ZERO_WIDTH) ? 0 : within(cp, WIDE) ? 2 : 1
  }
  return n
}

/** `shorten` in terminal cells: cut by whole code point (never half a surrogate pair), `…` when cut. */
export const shortenCells = (s: string, cells: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (cells <= 0) return ''
  if (cellWidth(one) <= cells) return one
  let out = ''
  let used = 0
  for (const ch of one) {
    const w = cellWidth(ch)
    if (used + w > cells - 1) break
    out += ch
    used += w
  }
  return `${out.trimEnd()}…`
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

/**
 * An ended card (done, stopped, failed) running again: a message resumed it under its own id. Its
 * clock runs on from its spawn; turn.complete ends it again.
 */
export const resumeCard = (c: AgentCard): AgentCard =>
  c.status === 'done' || c.status === 'stopped' || c.status === 'failed' ? { ...c, status: 'running', endedAt: null } : c

/**
 * A card after one of its model requests: its context is the latest step's whole input; output adds
 * up. A step on an ended card means it was resumed (no event says so): it runs again.
 */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...resumeCard(c),
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    out: c.out + (u.output_tokens ?? 0),
    lastStop: s.stopReason,
  }
}

// ---------------------------------------------------------------- messages between agents

/** A message seen leaving at session.send, waiting for the session.receive that delivers it. */
export type PendingMessage = { from: string; to: string | null; text: string; at: number }

/** An agent as `$.agent.list()` lists it, as far as addressing goes. */
export type Addressee = { id: string; name?: string; teammateId?: string }

/**
 * Whom a SendMessage `to` means, by id: a card's id, or a listed agent's id, name or team address
 * (a ` [a1b2c3]` suffix dropped), or the one card spawned under that name (a card's `type` holds
 * the Agent call's `name` when it had one). Null when nothing matches: the main loop, another
 * session, or an agent gone from the list with no card.
 */
export const resolveRecipient = (to: string, cards: AgentCard[], listed: readonly Addressee[]): string | null => {
  const t = to.replace(/\s*\[[^\]]*\]\s*$/, '').trim()
  if (!t) return null
  const card = cards.find(c => c.id === t || c.id === to)
  if (card) return card.id
  const agent = listed.find(a => a.id === t || a.name === t || a.teammateId === t)
  if (agent) return agent.id
  const named = cards.filter(c => c.type === t)
  return named.length === 1 ? named[0]?.id ?? null : null
}

/** How long a send waits for its delivery before it is dropped (one to another session never comes). */
export const PENDING_MS = 60_000

/**
 * The waiting sends, oldest first, after `p` leaves at `now` (or with none, just pruned): those
 * waiting longer than PENDING_MS dropped, then the oldest past 20.
 */
export const queuePending = (pending: readonly PendingMessage[], now: number, p?: PendingMessage): PendingMessage[] =>
  [...pending.filter(x => now - x.at < PENDING_MS), ...(p ? [p] : [])].slice(-20)

/**
 * Which waiting message a delivery to `to` completes: there is no id common to a send and its
 * receive, so the latest one sent to that recipient, else the latest one whose recipient was not
 * resolved, else the latest of all. -1 when none waits.
 */
export const pickPending = (pending: readonly PendingMessage[], to: string): number => {
  const last = (ok: (p: PendingMessage) => boolean) => {
    for (let i = pending.length - 1; i >= 0; i -= 1) if (ok(pending[i] as PendingMessage)) return i
    return -1
  }
  const exact = last(p => p.to === to)
  if (exact >= 0) return exact
  const open = last(p => p.to === null)
  return open >= 0 ? open : pending.length - 1
}

/** A message for the log: tags stripped, credentials masked, on one line, cut to `cells`. */
export const messageExcerpt = (text: string, cells: number) => shortenCells(redact(text.replace(/<[^>]*>/g, ' ')), cells)

/** The agent a task notification is about: its `<task-id>`. */
export const taskIdOf = (text: string) => /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1] ?? null

/**
 * The cards after one message from `from` to `to` (each `main` or an agent's id): the sender's
 * `sent` and the recipient's `received` count it, both note when; an ended recipient runs again,
 * the message having resumed it.
 */
export const noteMessage = (cards: AgentCard[], m: { from: string | null; to: string; at: number }): AgentCard[] =>
  cards.map(c => {
    if (c.id === m.to) return { ...resumeCard(c), received: c.received + 1, lastMessageAt: m.at, lastMessageDir: 'out' as const }
    if (c.id === m.from) return { ...c, sent: c.sent + 1, lastMessageAt: m.at, lastMessageDir: 'in' as const }
    return c
  })

/** How long a card's border flashes after a message. */
export const FLASH_MS = 2500

export const isFlashing = (c: AgentCard, now: number) =>
  c.lastMessageAt !== null && now >= c.lastMessageAt && now - c.lastMessageAt < FLASH_MS

/** How long an exchange runs along the trunk between main and a card. */
export const PULSE_MS = 3000

/** Which way an exchange runs on the trunk: `out` from main to the card, `in` back from it. */
export type PulseDir = 'in' | 'out'

/**
 * The exchange still running on a card's way at `now`, the latest of: its brief (spawned, out),
 * its report (ended, in), its last message (out to it, in from it); each for PULSE_MS. A time of
 * 0 is unknown, one ahead of `now` not yet: neither runs.
 */
export const cardPulse = (c: AgentCard, now: number): { dir: PulseDir; until: number } | null => {
  const events: [number | null, PulseDir][] = [
    [c.spawnedAt, 'out'],
    [c.endedAt, 'in'],
    [c.lastMessageAt, c.lastMessageDir ?? 'out'],
  ]
  let latest: { at: number; dir: PulseDir } | null = null
  for (const [at, dir] of events) {
    if (at === null || at <= 0 || at > now || now - at >= PULSE_MS) continue
    if (!latest || at >= latest.at) latest = { at, dir }
  }
  return latest ? { dir: latest.dir, until: latest.at + PULSE_MS } : null
}

/** A card's fifth row: the messages it received and sent, `✉ 2 in · 1 out`, or `✉ —` before any. */
export const cardMail = (c: AgentCard) => (c.sent + c.received > 0 ? `✉ ${c.received} in · ${c.sent} out` : '✉ —')

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

/** Rows one agent card takes in the list: its two borders, the title, type and model, tokens, status and messages. */
export const CARD_ROWS = 7

/** Cards kept in state, the oldest dropped past it; the swimlanes draw every one. */
export const MAX_CARDS = 24

/**
 * Rows the agents section takes: its frame and title, then a swimlane (one row) per agent, and
 * the card of the lane opened under it; nothing without a card.
 */
export const agentsRows = (cards: number, isLaneOpen = false) =>
  cards > 0 ? 3 + Math.min(cards, MAX_CARDS) + (isLaneOpen ? CARD_ROWS : 0) : 0

/** Rows beside each swimlane, in the tree's order: one, and the card's under the lane opened. */
export const laneHeights = (ids: string[], open: string | null) => ids.map(id => (id === open ? 1 + CARD_ROWS : 1))

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
 * title when at least 6 cells of it fit in `width`. Otherwise the parent waits for the expanded
 * card. Cut to `width` cells.
 */
export const cardKind = (c: AgentCard, parent: AgentCard | null, width: number) => {
  const base = `${c.type} · ${shortModel(c.model)}`
  const room = width - cellWidth(base) - 5
  return shortenCells(parent && room >= 6 ? `${base} · ↳ ${shortenCells(cardTitle(parent), room)}` : base, width)
}

/** A card's third row: its context, its output and its steps, or `starting…` before its first step. */
export const cardStats = (c: AgentCard) =>
  c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${plural(c.steps, 'step')}` : 'starting…'

// ---------------------------------------------------------------- context windows

/** A model id as the windows table keys it: lower case, trimmed. */
const windowKey = (id: string) => id.trim().toLowerCase()
/** The same model whatever its window variant: the `[1m]` suffix dropped. */
const modelFamily = (id: string) => windowKey(id).replace(/\[1m\]$/, '')

/** Windows by model, read leniently: only positive numbers. */
export const normalizeWindows = (stored: unknown): Record<string, number> =>
  isObject(stored) ? Object.fromEntries(Object.entries(stored).filter((kv): kv is [string, number] => typeof kv[1] === 'number' && kv[1] > 0)) : {}

/** The table after the main loop measured `window` on `model`; the latest 12 models kept. */
export const recordWindow = (windows: Record<string, number>, model: string, window: number): Record<string, number> => {
  const key = windowKey(model)
  if (!key || !(window > 0) || windows[key] === window) return windows
  const rest = Object.entries(windows).filter(([k]) => k !== key)
  return Object.fromEntries([...rest, [key, window] as [string, number]].slice(-12))
}

/**
 * An agent's context window. Only the main loop's is ever measured, so: exact when the main loop
 * was measured on this very model; inferred from the same model measured under another variant
 * (`[1m]` or not, whose windows may differ); inferred as the main loop's own otherwise; null when
 * nothing was measured.
 */
export const windowFor = (model: string, windows: Record<string, number>, mainWindow: number): { window: number; inferred: boolean } | null => {
  const exact = windows[windowKey(model)]
  if (model && exact && exact > 0) return { window: exact, inferred: false }
  const family = Object.entries(windows).find(([k, w]) => model && modelFamily(k) === modelFamily(model) && w > 0)
  if (family) return { window: family[1], inferred: true }
  return mainWindow > 0 ? { window: mainWindow, inferred: true } : null
}

/** A card's third row in runs: `ctx `, the gauge's filled and empty cells, the rest, compactions. */
export type StatsRow = { lead: string; on: string; off: string; tail: string; comp: string; level: 'ok' | 'high' | 'full' | null }

/**
 * A card's third row within `width` cells: `ctx ▰▰▰▱▱▱▱▱ 38% · out 3k · 7 steps ⟲1`, the
 * percentage marked `~` when the window is inferred, its level `high` from 70 % and `full` past
 * 90 %. Narrower, the gauge takes 4 cells, then none; with no window, `ctx 12k` as before.
 */
export const cardStatsRow = (c: AgentCard, win: { window: number; inferred: boolean } | null, width: number): StatsRow => {
  const none = { on: '', off: '', tail: '', comp: '', level: null }
  if (c.steps === 0) return { ...none, lead: shortenCells('starting…', width) }
  const compacted = c.compactions > 0 ? ` ⟲${c.compactions}` : ''
  const comp = cellWidth(compacted) < width ? compacted : ''
  const room = width - cellWidth(comp)
  if (!win) return { ...none, comp, lead: shortenCells(cardStats(c), room) }
  const pct = Math.round((c.ctx / win.window) * 100)
  const level = pct > 90 ? 'full' : pct >= 70 ? 'high' : 'ok'
  const tail = ` ${pct}%${win.inferred ? '~' : ''} · out ${kTokens(c.out)} · ${plural(c.steps, 'step')}`
  for (const cells of [8, 4]) {
    if (4 + cells + cellWidth(tail) <= room) {
      const g = gauge(pct, cells)
      return { lead: 'ctx ', on: g.on, off: g.off, tail, comp, level }
    }
  }
  return { ...none, comp, level, lead: 'ctx', tail: ` ${shortenCells(tail, Math.max(0, room - 4))}` }
}

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

/** One row of the cards' trunk column: its branch glyphs, whether its card runs, and which of its cells lead to a running card. */
export type SpineRow = { prefix: string; active: boolean; flow: boolean[] }

/** The trunk column's widest, in cells: three levels of two (the main loop's agents, theirs, and theirs). */
export const SPINE_MAX = 6

/** Levels the cards' trunk draws apart: 0 (the main loop's agents), 1 and 2; deeper ones share level 2's column. */
const SPINE_LEVELS = (SPINE_MAX - 2) / 2

/**
 * The cards' trunk column: `height` rows beside each card (one number for all, or one per card),
 * in the tree's order, all one width.
 * A card's branch (`├─`, the last one at its level `└─`) is on its top row and runs on in `─` to
 * the card; a card with children drops a `┬` there, and their line runs down beside it. A line
 * goes on down while a later card hangs at its column before a shallower one. Past level 2, cards
 * are drawn at level 2 with their own branch. `flow` marks the cells on the way from the top to
 * each running card: up its own line, through each ancestor's `┬` and branch, to the trunk.
 */
export const cardSpine = (input: { depth: number; active: boolean }[], height: number | number[] = CARD_ROWS): { rows: SpineRow[]; width: number } => {
  const tall = (i: number) => Math.max(1, Math.floor(typeof height === 'number' ? height : (height[i] ?? 1)))
  // The card each row stands beside, and each card's top row.
  const owner: number[] = []
  const tops: number[] = []
  input.forEach((_, i) => {
    tops.push(owner.length)
    for (let k = 0; k < tall(i); k += 1) owner.push(i)
  })
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
    for (let k = 1; k < tall(i); k += 1) lines.push(below)
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
    const top = tops[i] ?? 0
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
  return { rows: lines.map((p, k) => ({ prefix: p, active: input[owner[k] ?? -1]?.active ?? false, flow: flow[k] ?? [] })), width }
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

// ---------------------------------------------------------------- review verdicts

/** `Verdict : **MINEUR**`, `**Verdict global : OK**`, ``Verdict : `OK` ``, `Verdict — BLOQUANT`: the word right after "verdict". */
const VERDICT_SAID = /verdict\b[\s*_`]*(?:global[\s*_`]*)?[:：\-–—]?[\s*_`]*(BLOQUANT|MINEUR|OK)\b/i
/** A word in capitals, unless negated ("aucun BLOQUANT", "no MINEUR"). */
const said = (word: string) => new RegExp(`(?<!\\b(?:[Aa]ucune?|[Pp]as de|[Ss]ans|[Nn]o|[Zz]ero|0)\\s+(?:\\*\\*)?)\\b${word}\\b`)
const SEVERITY: [ReviewVerdict, RegExp][] = [
  ['BLOQUANT', said('BLOQUANT')],
  ['MINEUR', said('MINEUR')],
  // An OK on its own is too common to be a verdict: only in bold.
  ['OK', /\*\*\s*OK\s*\*\*/],
]
/**
 * The verdict a review agent's report gives, read from its text: the word after "verdict" when it
 * says one; otherwise the gravest anywhere in it, BLOQUANT over MINEUR over a bold OK (a report
 * of checks in bold `**OK**` with two MINEUR points is MINEUR); null when it states none. A warning
 * or a header before it does not matter. A text reading.
 */
export const verdictOf = (answer: string): ReviewVerdict | null => {
  const word = VERDICT_SAID.exec(answer)?.[1]
  if (word) return word.toUpperCase() as ReviewVerdict
  return SEVERITY.find(([, re]) => re.test(answer))?.[0] ?? null
}

export const elapsedOf = (c: AgentCard, now: number) => (c.endedAt ?? now) - c.spawnedAt

// ---------------------------------------------------------------- the agent view: one agent's conversation

/** A tool call as `$.session.messages` reports it (ToolUseSummary), or as a saved transcript rebuilds it. */
export type ToolUseLike = { tool: string; input?: unknown; text?: string; isError?: boolean }

/** A message as `$.session.messages` reports it (SessionMessage), or as a saved transcript rebuilds it. */
export type MessageLike = { role: 'user' | 'assistant'; text: string; toolUses?: readonly ToolUseLike[] }

/** What the pane keeps of a conversation: its end, at most this many messages and characters. */
export type FeedBudget = { entries: number; chars: number }
export const FEED_BUDGET: FeedBudget = { entries: 400, chars: 60_000 }
/** One message's text past this is cut, so one long prompt cannot take the whole budget. */
export const FEED_TEXT_MAX = 6_000
/** A result's lines shown under its call, each cut to FEED_LINE_MAX characters. */
export const FEED_RESULT_LINES = 3
export const FEED_LINE_MAX = 300
/** The least time between two reads of the conversation while the agent runs. */
export const FEED_DEBOUNCE_MS = 1_000
/** A transcript file over this is not read: `$.fs.read` rejects past 4 MiB. */
export const TRANSCRIPT_MAX_BYTES = 4 * 1024 * 1024

const clip = (s: string, n: number) => {
  const cps = [...s]
  return cps.length > n ? `${cps.slice(0, n).join('').trimEnd()}… (+${cps.length - n} chars)` : s
}

const feedTool = (u: ToolUseLike): FeedTool => {
  const isPending = u.text === undefined && u.isError !== true
  const lines = isPending
    ? []
    : redact(u.text ?? '')
        .split(/\r?\n/)
        .map(l => l.replace(/\t/g, '  ').trimEnd())
        .filter(l => l.trim() !== '')
  return {
    text: shorten(describeInput(u.tool, u.input), FEED_LINE_MAX),
    isError: u.isError === true,
    result: lines.slice(0, FEED_RESULT_LINES).map(l => clip(l, FEED_LINE_MAX)),
    more: Math.max(0, lines.length - FEED_RESULT_LINES),
    isPending,
  }
}

/** What an entry takes once stored: its JSON text, as `$.state` keeps it. */
const sizeOf = (v: unknown) => JSON.stringify(v).length

/**
 * One message held to `max` stored characters: its earliest calls dropped first (counted in
 * `toolsOmitted`), then its text cut, so even the newest message, always kept, stays bounded.
 */
const boundEntry = (e: FeedEntry, max: number): FeedEntry => {
  if (sizeOf(e) <= max) return e
  const bare = sizeOf({ ...e, tools: [], toolsOmitted: e.tools.length })
  const sizes = e.tools.map(t => sizeOf(t) + 1)
  let total = bare + sizes.reduce((n, s) => n + s, 0)
  let dropped = 0
  while (dropped < e.tools.length && total > max) total -= sizes[dropped++] as number
  let out: FeedEntry = dropped > 0 ? { ...e, tools: e.tools.slice(dropped), toolsOmitted: dropped } : e
  for (let i = 0; i < 8 && sizeOf(out) > max && out.text; i += 1) {
    const keep = Math.max(0, [...out.text].length - (sizeOf(out) - max) - 40)
    out = { ...out, text: keep > 0 ? clip(e.text, keep) : '' }
  }
  return out
}

/**
 * An agent's conversation as the pane draws it: each message's role, its text and its tool calls
 * with the start of their results, every string redacted and cut. Rows holding only tool results
 * fold into the calls they answer; only the end is kept, within the budget, and `omitted` counts
 * the messages before it. Nothing here depends on the pane's width.
 */
export const feedOf = (messages: readonly MessageLike[], budget: FeedBudget = FEED_BUDGET): { entries: FeedEntry[]; omitted: number } => {
  const all: FeedEntry[] = []
  for (const m of messages) {
    const text = clip(redact((m.text ?? '').trim()), FEED_TEXT_MAX)
    const tools = (m.toolUses ?? []).map(feedTool)
    if (text === '' && tools.length === 0) continue
    all.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text, tools })
  }
  let chars = 0
  let start = all.length
  while (start > 0 && all.length - start < budget.entries) {
    const entry = boundEntry(all[start - 1] as FeedEntry, budget.chars)
    // One more for the comma between entries in the stored list.
    const size = sizeOf(entry) + 1
    if (start < all.length && chars + size > budget.chars) break
    all[start - 1] = entry
    chars += size
    start -= 1
  }
  return { entries: all.slice(start), omitted: start }
}

type Block = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown }

const blocksOf = (content: unknown): Block[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content.filter(isObject) : []

const resultText = (content: unknown) =>
  blocksOf(content)
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')

/**
 * A saved subagent transcript (JSONL: one `{ type, message: { content } }` per line) read back as
 * `$.session.messages` would report it: an assistant message's blocks (saved one per line under
 * one message id) joined, thinking left out, each tool result paired with its call by id. A line
 * that does not parse, a meta row and any other kind of row are skipped.
 */
export const jsonlMessages = (text: string): MessageLike[] => {
  type Use = { tool: string; input: unknown; text?: string; isError?: boolean }
  const out: { role: 'user' | 'assistant'; text: string; toolUses: Use[] }[] = []
  const calls = new Map<string, Use>()
  let lastId: unknown = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(row) || (row.type !== 'user' && row.type !== 'assistant') || row.isMeta === true) continue
    const message = isObject(row.message) ? row.message : {}
    const blocks = blocksOf(message.content)
    if (row.type === 'assistant') {
      const prev = out[out.length - 1]
      const id = message.id ?? null
      const m = prev && prev.role === 'assistant' && id !== null && id === lastId ? prev : { role: 'assistant' as const, text: '', toolUses: [] }
      if (m !== prev) out.push(m)
      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) m.text = m.text ? `${m.text}\n${b.text}` : b.text
        else if (b.type === 'tool_use') {
          const use: Use = { tool: typeof b.name === 'string' ? b.name : 'tool', input: b.input }
          if (typeof b.id === 'string') calls.set(b.id, use)
          m.toolUses.push(use)
        }
      }
      lastId = id
    } else {
      lastId = null
      const texts: string[] = []
      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
        else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const use = calls.get(b.tool_use_id)
          if (!use) continue
          use.text = resultText(b.content)
          if (b.is_error === true) use.isError = true
        }
      }
      out.push({ role: 'user', text: texts.join('\n'), toolUses: [] })
    }
  }
  return out
}

/**
 * Where an agent's saved transcript is: the path its `SubagentStop` named, else beside the main
 * transcript (`<session>.jsonl` → `<session>/subagents/agent-<id>.jsonl`), else rebuilt from the
 * config directory, the working directory (every character but a letter or digit made `-`) and the
 * session id, a layout no API documents. Null when none of these is known, or for an id that is
 * not a plain name.
 */
export const transcriptPath = (o: {
  agentId: string
  known?: string | null
  mainTranscript?: string | null
  configDir?: string
  home?: string
  cwd?: string
  sessionId?: string
}): string | null => {
  if (o.known) return o.known
  if (!/^[A-Za-z0-9_-]+$/.test(o.agentId)) return null
  const file = `subagents/agent-${o.agentId}.jsonl`
  if (o.mainTranscript && /\.jsonl$/.test(o.mainTranscript)) return `${o.mainTranscript.replace(/\.jsonl$/, '')}/${file}`
  const base = o.configDir ? o.configDir.replace(/[\\/]+$/, '') : o.home ? `${o.home.replace(/[\\/]+$/, '')}/.claude` : ''
  if (!base || !o.cwd || !o.sessionId || !/^[A-Za-z0-9_-]+$/.test(o.sessionId)) return null
  return `${base}/projects/${o.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${o.sessionId}/${file}`
}

/** Why a read failed, short enough for the pane: credentials masked, a path cut to its file name. */
export const shortReason = (err: unknown) =>
  shorten(redact(err instanceof Error ? err.message : String(err)).replace(/(?:[A-Za-z]:)?[\\/](?:[^\s\\/:'"]+[\\/])+([^\s\\/:'"]+)/g, '…/$1'), 160)

/** A window over a tree that shows its last row: where the person left the agent view to keep following. */
export const isAtEnd = (w: { offset: number; bodyRows: number; contentRows: number }) => w.offset + w.bodyRows >= w.contentRows

/** A stored feed, or null when what is stored is not one. */
export const normalizeFeed = (stored: unknown): AgentFeed | null => {
  if (!isObject(stored) || typeof stored.agentId !== 'string' || !stored.agentId) return null
  return {
    agentId: stored.agentId,
    entries: listOf<FeedEntry>(stored.entries),
    omitted: typeof stored.omitted === 'number' && stored.omitted > 0 ? stored.omitted : 0,
    readAt: typeof stored.readAt === 'number' ? stored.readAt : 0,
    source: stored.source === 'transcript' ? 'transcript' : 'session',
    deny: typeof stored.deny === 'string' ? stored.deny : null,
  }
}

/**
 * The agent view's heading, within `width` cells: `Agent · <task>`, then ` · <state>` (its state
 * and model). The task gives way first; with fewer than 6 cells of it left, the state does.
 */
export const agentHeading = (title: string, state: string, width: number): { head: string; tail: string } => {
  const lead = 'Agent · '
  const task = title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || 'agent'
  const tail = ` · ${state}`
  const room = width - cellWidth(lead) - cellWidth(tail)
  if (room >= 6) return { head: lead + shortenCells(task, room), tail }
  return { head: shortenCells(lead + task, width), tail: '' }
}

/** The agent before (-1) or after (1) `id` in the tree's order (agentTree), or null at an end or for an id with no card. */
export const neighbourAgent = (cards: AgentCard[], id: string, step: -1 | 1): string | null => {
  const order = agentTree(cards).map(row => row.card.id)
  const i = order.indexOf(id)
  return i < 0 ? null : (order[i + step] ?? null)
}

/** `1.5 MiB`, `512 KiB`. */
export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(n / 1024))} KiB`)
