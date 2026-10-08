import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, AgentFeed, Architect, Bucket, Check, Gate, Layout, LogLine, Loop, Main, ReviewVerdict, Roster, Turn, Usage, View } from '../types'
import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  FEED_DEBOUNCE_MS,
  SCHEMA_VERSION,
  TRANSCRIPT_MAX_BYTES,
  afterCall,
  agentHeading,
  agentTree,
  agentsRows,
  laneHeights,
  applyStep,
  bucketOf,
  cardKind,
  cardMail,
  cardSpine,
  cardStatsRow,
  cardTitle,
  cellWidth,
  CLAWD,
  CLAWD_COLORS,
  consultTimeline,
  describeInput,
  endConsult,
  feedOf,
  FLASH_MS,
  fmtBytes,
  fitLegend,
  fmtClock,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  plural,
  gateSummary,
  gauge,
  isAdvising,
  isFlashing,
  isAtEnd,
  isLoopActive,
  jsonlMessages,
  kTokens,
  limitLabel,
  listOf,
  logRows,
  MAX_CARDS,
  messageExcerpt,
  momentOf,
  neighbourAgent,
  normalize,
  normalizeCard,
  normalizeFeed,
  normalizeGate,
  normalizeLog,
  normalizeWindows,
  noteMessage,
  noteTool,
  PALETTES,
  SVG_COLORS,
  parseConfig,
  parentLabel,
  pickPending,
  queuePending,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  recordWindow,
  redact,
  resolveRecipient,
  settleCheck,
  shorten,
  shortenCells,
  shortModel,
  shortReason,
  startConsult,
  stepLoop,
  taskIdOf,
  timeBars,
  transcriptPath,
  verdictOf,
  windowFor,
} from './core'
import { clawdSvg } from './clawd-svg'
import type { ClawdSpan, Config, Panel, PendingMessage } from './core'

const PANE = 'flightdeck'
const TITLE = 'Flightdeck'
const PANE_COLUMNS = 66
/** A read waits this long after the event that asked for it, so the row behind it is stored. */
const FEED_SETTLE_MS = 100


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'flightdeck', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'flightdeck', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'flightdeck', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'flightdeck', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'flightdeck', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'flightdeck', key: 'agents' } as const, [])
const loops = atom({ plugin: 'flightdeck', key: 'loops' } as const, [])
const log = atom({ plugin: 'flightdeck', key: 'log' } as const, [])
const turn = atom({ plugin: 'flightdeck', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'flightdeck', key: 'receipt' } as const, null)
const view = atom({ plugin: 'flightdeck', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'flightdeck', key: 'roster' } as const, DEFAULT_ROSTER)
const windows = atom({ plugin: 'flightdeck', key: 'windows' } as const, {})
const agentFeed = atom({ plugin: 'flightdeck', key: 'agentFeed' } as const, null)

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getLog($: EngineInterface): Promise<LogLine[]> {
  return normalizeLog(await read($, log))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  const v = normalize(DEFAULT_VIEW, await read($, view))
  return { ...v, agent: typeof v.agent === 'string' && v.agent ? v.agent : null }
}
async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}

async function getFeed($: EngineInterface): Promise<AgentFeed | null> {
  return normalizeFeed(await read($, agentFeed))
}

async function getWindows($: EngineInterface): Promise<Record<string, number>> {
  return normalizeWindows(await read($, windows))
}

/** The main loop's context window, measured: learnt for its model, the only one ever measured. */
async function learnWindow($: EngineInterface, window: number) {
  const model = (await getMain($)).model
  if (model && window > 0) await update($, windows, w => recordWindow(normalizeWindows(w), model, window))
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, log, list => normalizeLog(list))
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

async function say($: EngineInterface, who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  const line: LogLine = { at: await $.clock.now(), who, text, kind, agentId }
  await update($, log, list => [...normalizeLog(list), line].slice(-60))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [u, a, g, cards] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($)])
  const running = cards.filter(c => c.status === 'running').length
  const s = gateSummary(g)
  const parts = [
    u.pct !== null ? `ctx ${Math.round(u.pct)}%` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    s.deny > 0 ? `denied ${s.deny}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
}

async function whoIs($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return 'main'
  const card = (await getCards($)).find(c => c.id === agentId)
  return card ? shorten(cardTitle(card), 14) : 'agent'
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = await $.clock.now()
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await say($, cfg.architectLabel.toLowerCase(), cfg.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const first = advice?.split('\n').find(l => l.trim()) ?? null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  await say($, cfg.architectLabel.toLowerCase(), text ? `advice: ${shorten(text, 60)}` : 'advice returned', 'consult')
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
  await say($, cfg.architectLabel.toLowerCase(), `advice: ${shorten(advice, 60)}`, 'consult')
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8 })
}

async function resetAll($: EngineInterface) {
  // The agent in view goes too, as `b` takes it: no read of its conversation after this.
  await closeAgentView($, true)
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, log, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  await update($, view, () => DEFAULT_VIEW)
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null }))
}

/** The session's cost read fresh, not from the last measurement: the receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return u?.cost?.usd ?? null
}

/** Where the session keeps its files, for a transcript path no event has named yet. */
async function whereabouts($: EngineInterface) {
  const [configDir, home, cwd, sessionId] = await Promise.all([
    $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined),
    $.env.get('HOME').catch(() => undefined),
    $.session.cwd().catch(() => undefined),
    $.session.id().catch(() => undefined),
  ])
  return { configDir, home, cwd, sessionId }
}

/**
 * An agent's conversation, read in a hook (a render may not write state): from the session, else,
 * when the session no longer serves it (`{ deny }`), from its saved transcript. What could not be
 * read is said in `deny`; whatever else fails rejects, and refreshFeed says that instead.
 */
async function readFeed($: EngineInterface, agentId: string, where: { known: string | null; mainTranscript: string | null }): Promise<AgentFeed> {
  const readAt = await $.clock.now().catch(() => 0)
  const empty = { agentId, entries: [], omitted: 0, readAt }
  const got = await $.session.messages({ agentId }).catch((err: unknown) => ({ deny: shortReason(err) }))
  if (Array.isArray(got)) return { ...empty, ...feedOf(got), source: 'session', deny: null }
  const denied = shortReason(got.deny)
  const known = where.known || where.mainTranscript ? {} : await whereabouts($)
  const path = transcriptPath({ agentId, ...where, ...known })
  const unavailable = (why: string): AgentFeed => ({ ...empty, source: 'transcript', deny: `${denied} · ${why}` })
  if (!path) return unavailable('no transcript path known')
  const stat = await $.fs.stat(path).catch(() => null)
  if (!stat || stat.kind !== 'file') return unavailable('no saved transcript')
  if (stat.size > TRANSCRIPT_MAX_BYTES) return unavailable(`saved transcript is ${fmtBytes(stat.size)}, over the 4 MiB read limit`)
  const text = await $.fs.read(path).catch((err: unknown) => new Error(shortReason(err)))
  if (text instanceof Error) return unavailable(`saved transcript unreadable: ${text.message}`)
  return { ...empty, ...feedOf(jsonlMessages(text)), source: 'transcript', deny: null }
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

/** A message leaving at session.send, as it will wait for its delivery: who sent it, to whom, what it says. */
async function outgoing($: EngineInterface, e: { to: string; text: string; agentId?: string }): Promise<PendingMessage> {
  const [cards, listed] = await Promise.all([getCards($), $.agent.list().catch(() => [])])
  return { from: e.agentId ?? 'main', to: resolveRecipient(e.to, cards, listed), text: messageExcerpt(e.text, 80), at: await $.clock.now() }
}

/** A compaction that ran: the main loop's in the usage, a subagent's on its card; both logged. */
async function noteCompaction($: EngineInterface, e: { trigger: string; agentId?: string }, done: { skip?: string; tokensBefore?: number; tokensAfter?: number }) {
  if (!e.agentId && e.trigger !== 'precompute') {
    const now = await $.clock.now()
    await update($, usage, x => {
      const u = normalize(DEFAULT_USAGE, x)
      return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
    })
    await say($, 'main', `context compacted (${e.trigger})`)
  } else if (e.agentId && e.trigger !== 'precompute' && done.skip === undefined) {
    // A subagent's own transcript compacted: counted on its card.
    const id = e.agentId
    if ((await getCards($)).some(c => c.id === id)) {
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? { ...c, compactions: c.compactions + 1 } : c)))
      const sizes = done.tokensBefore !== undefined && done.tokensAfter !== undefined ? ` · ${kTokens(done.tokensBefore)}→${kTokens(done.tokensAfter)}` : ''
      await say($, await whoIs($, id), `compacted (${e.trigger})${sizes}`, 'info', id)
    }
  }
}

/**
 * A delivery at session.receive: a task notification marks its agent's card; a message from the
 * main loop or an agent completes the send waiting for it, counts on both cards, resumes an ended
 * recipient and goes to the log.
 */
async function noteDelivery($: EngineInterface, cfg: Config, pending: PendingMessage[], e: { origin: { kind: string }; text: string; agentId?: string }) {
  const to = e.agentId ?? 'main'
  // The main loop told an agent finished: noted on its card, not counted as a message.
  if (e.origin.kind === 'task-notification') {
    const id = taskIdOf(e.text)
    if (id) await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? { ...c, notified: true } : c)))
    return
  }
  // A message from the main loop or another agent; other deliveries (a relay, a trigger) are not.
  if (e.origin.kind !== 'coordinator' && e.origin.kind !== 'peer' && e.origin.kind !== 'peer-send-message') return
  // Sends waiting longer than PENDING_MS (to another session, say) are dropped first.
  pending.splice(0, pending.length, ...queuePending(pending, await $.clock.now()))
  const i = pickPending(pending, to)
  // A subagent's hand-back is its report, not a message: unless a send waits, it is not counted.
  if (i < 0 && handbackOf(e.text)) return
  const p = i >= 0 ? pending.splice(i, 1)[0] : undefined
  const from = p?.from ?? (e.origin.kind === 'coordinator' ? 'main' : null)
  if (from === to) return
  const at = await $.clock.now()
  const cards = await getCards($)
  await update($, agents, list => noteMessage(listOf<unknown>(list).map(normalizeCard), { from, to, at }))
  const label = (id: string | null, n: number) => {
    if (id === 'main') return 'main'
    const card = cards.find(c => c.id === id)
    return card ? shortenCells(cardTitle(card), n) : 'agent'
  }
  const text = shortenCells(p?.text ?? messageExcerpt(e.text, 80), 60)
  await say($, label(from, 12), `→ ${label(to, 20)} · « ${text} »`, 'message', to !== 'main' ? to : from !== 'main' ? from : null)
  // The flash ends with no event of its own: draw again once it is over.
  $.clock.after(FLASH_MS + 50, () => $.ui.invalidate('ui.render'))
  await refreshStatus($, cfg)
}

// ---------------------------------------------------------------- the agent view's bookkeeping

// The module's own, gone on a reload (each is then read again). Saved transcripts by agent, as
// SubagentStop names them; the main one, from the envelope of UserPromptSubmit or SubagentStop.
const agentTranscripts = new Map<string, string>()

/** A read waiting: `due` is Infinity while it is being armed; `epoch` the open it belongs to. */
type FeedTimer = { cancel: () => void; due: number; epoch: number }

/** A read past its time by this much never ran (its timer refused or lost): the next event replaces it. */
const FEED_STALE_MS = 5_000

const feedWatch: {
  mainTranscript: string | null
  /** The agent in view; undefined after a reload, until the stored feed is read once. */
  agent: string | null | undefined
  lastReadAt: number
  timer: FeedTimer | null
  /** Bumped by every stop (an open, a close): a read of an older epoch writes nothing. */
  epoch: number
  /** Keep the pane at the end: true when an agent comes into view, then whatever the person's last scroll left. */
  follow: boolean
} = { mainTranscript: null, agent: undefined, lastReadAt: 0, timer: null, epoch: 0, follow: true }

async function followedAgent($: EngineInterface): Promise<string | null> {
  if (feedWatch.agent === undefined) feedWatch.agent = (await getFeed($))?.agentId ?? null
  return feedWatch.agent
}

/** Cancels the read waiting, if any; a read already under way finds its epoch gone and writes nothing. */
function stopFeed() {
  feedWatch.timer?.cancel()
  feedWatch.timer = null
  feedWatch.epoch += 1
}

/**
 * Reads the followed agent's conversation into the pane's state, then keeps the end in view.
 * Never rejects: a read that fails leaves the reason in the pane (`transcript unavailable: …`).
 */
async function refreshFeed($: EngineInterface, id: string, epoch: number) {
  const f = await readFeed($, id, { known: agentTranscripts.get(id) ?? null, mainTranscript: feedWatch.mainTranscript }).catch(
    (err: unknown): AgentFeed => ({ agentId: id, entries: [], omitted: 0, readAt: feedWatch.lastReadAt, source: 'session', deny: shortReason(err) }),
  )
  // Back to the dashboard, or another agent in view, while it read.
  if (epoch !== feedWatch.epoch || feedWatch.agent !== id) return
  if (f.readAt > 0) feedWatch.lastReadAt = f.readAt
  const isWritten = await update($, agentFeed, () => f).then(
    () => true,
    () => false,
  )
  if (isWritten && feedWatch.follow) await $.ui.scroll({ in: PANE, to: 'end' }).catch(() => undefined)
}

/**
 * Something happened in an agent's loop: when it is in view, read again, at most once a
 * FEED_DEBOUNCE_MS and never at once (the row behind the event lands first). A read already
 * waiting covers every event until it runs, the agent's last one included; its slot is taken
 * before the first await, so events arriving together arm one read.
 */
async function requestFeed($: EngineInterface, id: string) {
  if (feedWatch.agent === null || (feedWatch.agent !== undefined && feedWatch.agent !== id)) return
  const held = feedWatch.timer
  if (held) {
    if (held.due === Infinity) return
    const now = await $.clock.now().catch(() => null)
    // Still waiting in time, or replaced meanwhile: it covers this event.
    if (now === null || feedWatch.timer !== held || now < held.due + FEED_STALE_MS) return
    held.cancel()
  }
  const mine: FeedTimer = { cancel: () => undefined, due: Infinity, epoch: feedWatch.epoch }
  feedWatch.timer = mine
  const release = () => {
    if (feedWatch.timer === mine) feedWatch.timer = null
  }
  try {
    if ((await followedAgent($)) !== id) return release()
    const now = await $.clock.now()
    if (feedWatch.timer !== mine) return
    const delay = Math.max(FEED_SETTLE_MS, feedWatch.lastReadAt + FEED_DEBOUNCE_MS - now)
    mine.due = now + delay
    const timer = $.clock.after(delay, () => {
      if (feedWatch.timer !== mine) return
      feedWatch.timer = null
      void refreshFeed($, id, mine.epoch)
    })
    mine.cancel = () => timer.cancel()
  } catch {
    release()
  }
}

/**
 * A card's `inspect` pressed (or prev, next): the pane turns to that agent's conversation, read
 * now, its top in view. No second pane: one opened beside Flightdeck stays behind it, as a
 * pressed Button's pane keeps the focus an `open({ focus })` asks for. The pressed element is
 * gone from the drawing, so the focus ring is put on `back`, where b, p, n and i keep working.
 * Never rejects.
 */
async function openAgent($: EngineInterface, card: AgentCard, isFocused = true) {
  stopFeed()
  const epoch = feedWatch.epoch
  feedWatch.agent = card.id
  // From the top: the end is followed again once the person scrolls down to it.
  feedWatch.follow = false
  // Its heading and a "reading" line at once, not the previous agent's conversation.
  const reading: AgentFeed = { agentId: card.id, entries: [], omitted: 0, readAt: 0, source: 'session', deny: null }
  await update($, agentFeed, () => reading).catch(() => undefined)
  await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), agent: card.id })).catch(() => undefined)
  await $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
  // From the dashboard only: prev and next leave the focus where the person put it.
  if (isFocused) await focusBack($)
  await refreshFeed($, card.id, epoch)
  // Back to the top after the first read, unless the person has scrolled down to the end meanwhile.
  if (epoch === feedWatch.epoch && !feedWatch.follow) await $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
}

/**
 * The focus ring on the agent view's `back`, so b, p, n and i reach the pane. Refused when the
 * pane no longer holds the keys (the pressed element is gone): then the pane asks for them, which
 * the surface grants only while the prompt holds them over an empty composer, and tries again.
 * Never rejects; a refusal left standing is said in the log, once per load.
 */
/** Whether the refusal was said since the module loaded. */
const focusWatch = { isSaid: false }

async function focusBack($: EngineInterface) {
  const refused = (r: { deny?: string } | null) => r === null || r.deny !== undefined
  const first = await $.ui.focus({ requestId: PANE, key: 'agent-back' }).catch(() => null)
  if (!refused(first)) return
  await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8, focus: true }).catch(() => undefined)
  const again = await $.ui.focus({ requestId: PANE, key: 'agent-back' }).catch(() => null)
  if (!refused(again) || focusWatch.isSaid) return
  focusWatch.isSaid = true
  await say($, 'flightdeck', 'agent view: the keys stayed with the prompt; focus the pane (ctrl+x tab) for b, p, n, i').catch(() => undefined)
}

/**
 * Back to the dashboard (b, an evicted card, the pane closed, the session ended): the conversation
 * goes, and no read of it runs after this. `toTop` brings the dashboard's top back into view.
 */
async function closeAgentView($: EngineInterface, toTop = false) {
  stopFeed()
  feedWatch.agent = null
  await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), agent: null }))
  await update($, agentFeed, () => null)
  if (toTop) await $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()
  // Messages seen leaving (session.send), each waiting for the delivery (session.receive) that
  // completes it: the two share no id, so they are matched in order (pickPending).
  const pending: PendingMessage[] = []

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flightdeck',
      description: 'Flightdeck, the live agent dashboard: open, close, reset, or set the layout',
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        costUsd: u.cost?.usd ?? null,
        limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
      }))
      await learnWindow($, u.context.window)
    }
    if (cfg.openOnStart) void openPane($).catch(() => undefined)
    await refreshStatus($, cfg)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (await followedAgent($).catch(() => null)) await closeAgentView($).catch(() => undefined)
    if (e.reason === 'clear') {
      await resetAll($)
      await refreshStatus($, cfg)
    }
    return next(e)
  })

  on('command.run', { command: 'flightdeck' }, async ($, e) => {
    const [verb = 'open', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'close') {
      await closeAgentView($).catch(() => undefined)
      await $.ui.close({ id: PANE })
      return { text: 'Flightdeck closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      await refreshStatus($, cfg)
      return { text: 'Flightdeck reset.' }
    }
    if (verb === 'layout') {
      const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
      if (!layout) return { text: 'Usage: /flightdeck layout auto|compact|wide|mini' }
      await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
      const opened = await openPane($)
      return { text: opened.isPlaced ? `Flightdeck layout: ${layout}.` : `Layout set to ${layout}; the pane is not shown yet: ${opened.reason}` }
    }
    const opened = await openPane($)
    if (!opened.isPlaced) return { text: `Flightdeck is not shown yet: ${opened.reason}` }
    return { text: "Flightdeck opened. Focus it with ctrl+x tab; 1-9 open an agent's card (inspect › shows its conversation, b back), f/s/o open the gate rows." }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.transcript_path) feedWatch.mainTranscript = e.transcript_path
    await noteMode($, e.permission_mode)
    return next(e)
  })

  // Watch only: where an agent's transcript was saved, for the agent view once the session no
  // longer serves its conversation.
  on('classic.SubagentStop', async ($, e, next) => {
    if (e.agent_id && e.agent_transcript_path) agentTranscripts.set(e.agent_id, e.agent_transcript_path)
    if (e.transcript_path) feedWatch.mainTranscript = e.transcript_path
    return next(e)
  })

  // Watch only: the pane closed (its close mark, a command): an agent in view goes with it, and
  // the pane opens again on the dashboard.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (await followedAgent($).catch(() => null)) await closeAgentView($).catch(() => undefined)
    return closed
  })

  // Watch only: in the agent view, the person's scroll decides whether it keeps following the end.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (e.origin.kind === 'person' && moved.deny === undefined && feedWatch.agent) feedWatch.follow = isAtEnd(e)
    return moved
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  })

  on('turn.start', async ($, e, next) => {
    const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const back = e.text ? handbackOf(e.text) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    } else if (e.text) {
      const p = promptLine(e.text)
      await say($, p.who, p.text)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, model: e.model, effort: String(e.effort ?? x.effort), steps: x.steps + 1 }
      })
      return yield* next(e)
    }
    const result = yield* next(e)
    const id = e.agentId
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
      if (result.stopReason === 'max_tokens') await say($, await whoIs($, id), 'hit max_tokens', 'error', id)
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    await requestFeed($, id).catch(() => undefined)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, x => ({
      ...normalize(DEFAULT_USAGE, x),
      pct: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      costUsd: e.cost?.usd ?? null,
      limits: e.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
    }))
    await learnWindow($, e.context.window)
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // Only watching: whatever fails here, the compaction stands as beneath answered it.
    try {
      await noteCompaction($, e, done)
    } catch {
      // nothing to undo
    }
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await say($, 'gate', `denied by rule · ${check.detail}`, 'error')
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    if (e.agentId) await requestFeed($, e.agentId).catch(() => undefined)
    const didRun = ran.deny === undefined
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    if (ran.deny !== undefined) await say($, await whoIs($, e.agentId), `${text}  denied`, 'error', e.agentId ?? null)
    else if (hasFailed) await say($, await whoIs($, e.agentId), `${text}  ✗`, 'error', e.agentId ?? null)
    else if (isEdit) await say($, await whoIs($, e.agentId), text, 'info', e.agentId ?? null)
    if (isSettled || !didRun) await refreshStatus($, cfg)
    return ran
  })

  // A message between loops: seen as it leaves, counted when it is delivered. Both hooks only
  // watch: the message goes on as it came, and a failure here never holds it back.
  on('session.send', async ($, e, next) => {
    const p = await outgoing($, e).catch(() => null)
    // Waiting before it goes: its delivery may be raised while it is being sent.
    if (p) pending.splice(0, pending.length, ...queuePending(pending, p.at, p))
    const drop = () => {
      const i = p ? pending.indexOf(p) : -1
      if (i >= 0) pending.splice(i, 1)
    }
    const sent = await next(e).catch((err: unknown) => {
      drop()
      throw err
    })
    if (!sent.isDelivered) drop()
    return sent
  })

  on('session.receive', async ($, e, next) => {
    await noteDelivery($, cfg, pending, e).catch(() => undefined)
    return next(e)
  })

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, `${block.name} tool`)
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      parentId: e.parentAgentId ?? null,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => [...listOf<unknown>(list).map(normalizeCard), card].slice(-MAX_CARDS))
    // The agent in view lost its card to this one: back to the dashboard.
    const inView = (await getView($)).agent
    if (inView && !(await getCards($)).some(c => c.id === inView)) await closeAgentView($, true).catch(() => undefined)
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    await say($, shorten(cardTitle(card), 12), `spawned · ${card.type}`, 'info', id)
    await refreshStatus($, cfg)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    const now = await $.clock.now()
    // The agent view reads its conversation one last time.
    if (id) await requestFeed($, id).catch(() => undefined)
    if (!id) {
      const [t, cards, cost] = await Promise.all([getTurn($), getCards($), costNow($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        costNow: cost,
        reason: e.reason,
      })
      await update($, receipt, () => r)
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      await refreshStatus($, cfg)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    const card = cards.find(c => c.id === id)
    if (card) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      // A review agent's verdict, read from its whole report (before the cut kept for the expanded card).
      const verdict = cfg.verdict.test(card.description) ? verdictOf(e.answer ?? '') : null
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(e.answer, 400), verdict } : c)),
      )
      const took = fmtDuration(now - card.spawnedAt)
      await say($, await whoIs($, id), status === 'done' ? `done · ${took}` : status, status === 'done' ? 'done' : 'error', id)
      if (verdict) await say($, 'verdict', `${shorten(cardTitle(card), 24)} · ${verdict}`, 'done', id)
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Only the terminal and the desktop draw a Client; elsewhere the table may still carry the
    // name, but what it draws is an empty box: those surfaces get the still drawing instead.
    const hasClient = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in els
    const [m, u, a, g, cards, lp, lines, t, r, v, now, wins, feed] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getLog($),
      getTurn($),
      read($, receipt),
      getView($),
      $.clock.now(),
      getWindows($),
      getFeed($),
    ])
    const W = Math.max(40, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = cfg.motion && hasClient
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      receipt: !m.isRunning && !r,
      log: false,
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    const decider = m.mode === 'auto' ? 'classifier' : 'you'

    // A connector between panels: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number) =>
      motion ? (
        <els.Client key={key} module="./rail.tsx" width={width} height={1} props={{ active, width, color, dim: C.faint }} />
      ) : (
        <Text color={C.faint}>{'─'.repeat(Math.max(1, width))}</Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClient ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    // ---- main
    const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
    const ctxGauge = u.pct !== null ? gauge(u.pct, 10) : null
    const mainPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.main} paddingX={1} width={w}>
        <Box justifyContent="space-between">
          <Text color={C.main} bold>
            {modelName} · main
          </Text>
          <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? '● working' : '○ idle'}</Text>
        </Box>
        <Text wrap="truncate">
          <Text dimColor>effort </Text>
          <Text color={C.main}>{'▮'.repeat(effortN) + '▯'.repeat(4 - effortN)} </Text>
          <Text color={C.main} bold>
            {m.effort || '—'}
          </Text>
          {m.mode ? <Text dimColor>{`   mode ${m.mode}`}</Text> : null}
          <Text dimColor>{`   ${m.steps} req`}</Text>
        </Text>
        {ctxGauge ? (
          <Text wrap="truncate">
            <Text dimColor>ctx </Text>
            <Text color={u.pct !== null && u.pct >= 80 ? C.warn : C.main}>{ctxGauge.on}</Text>
            <Text color={C.faint}>{ctxGauge.off}</Text>
            <Text bold>{` ${Math.round(u.pct ?? 0)}%`}</Text>
            {u.tokens !== null ? <Text dimColor>{` ${kTokens(u.tokens)}/${kTokens(u.window)}`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{`  ⟲${u.compactions}`}</Text> : null}
          </Text>
        ) : null}
        {(cfg.cost && u.costUsd !== null) || u.limits.length > 0 ? (
          <Text wrap="truncate">
            {cfg.cost && u.costUsd !== null ? <Text color={C.text}>{`${fmtUsd(u.costUsd)}   `}</Text> : null}
            {u.limits.slice(0, 2).map(l => {
              const lg = gauge(l.pct, 5)
              return (
                <Text wrap="truncate">
                  <Text dimColor>{`${limitLabel(l.kind)} `}</Text>
                  <Text color={l.pct >= 80 ? C.warn : C.main}>{lg.on}</Text>
                  <Text color={C.faint}>{lg.off}</Text>
                  <Text dimColor>{` ${Math.round(l.pct)}%  `}</Text>
                </Text>
              )
            })}
          </Text>
        ) : null}
      </Box>
    )

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    const architectPanel = (w: number) => {
      const tl = consultTimeline(a, now, Math.max(8, w - 4))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.arch} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.arch} bold>
              {cfg.architectLabel} · {advising ? 'advising' : 'on call'}
            </Text>
            <Text>
              <Text dimColor>consults </Text>
              <Text color={C.arch} bold>
                {a.consults.length}
              </Text>
            </Text>
          </Box>
          <Text color={C.arch}>{tl}</Text>
          {lastConsult ? (
            <Text dimColor wrap="truncate">
              {advising
                ? `consulting since ${fmtClock(lastConsult.at)}`
                : `last ${fmtDuration(now - (lastConsult.endAt ?? lastConsult.at))} ago · took ${fmtDuration((lastConsult.endAt ?? now) - lastConsult.at)}`}
            </Text>
          ) : (
            <Text dimColor>not consulted yet</Text>
          )}
          {cfg.moments ? (
            <Box flexWrap="wrap" columnGap={2}>
              {(['before a plan', 'error repeats', 'before done'] as const).map(mo => {
                const isOn = lastConsult?.moment === mo
                return (
                  <Text color={isOn ? C.arch : C.dim} bold={isOn}>
                    {isOn ? '◆' : '◇'} {mo}
                  </Text>
                )
              })}
              <Text color={C.faint}>(inferred)</Text>
            </Box>
          ) : null}
          {a.lastAdvice ? (
            <Text color={C.arch} wrap="truncate">
              » {a.lastAdvice}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- gate
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    const gatePanel = (w: number) => {
      const strip = g.recent.slice(-Math.max(8, w - 4))
      const open = v.gateOpen
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gate} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.gate} bold>
              {cfg.gateLabel} · permissions
            </Text>
            <Text dimColor>{`${s.total} checks`}</Text>
          </Box>
          <Box>
            {strip.length === 0 ? <Text color={C.faint}>no checks yet</Text> : null}
            {strip.map(c => (
              <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                {c.verdict === 'deny' ? '✗' : '■'}
              </Text>
            ))}
          </Box>
          <Text wrap="truncate">
            <Text color={C.gate}>■</Text>
            <Text dimColor>{` ${s.rule} allowed  `}</Text>
            <Text color={C.cleared}>■</Text>
            <Text dimColor>{` ${s.cleared} ${decider}  `}</Text>
            {s.ask > 0 ? <Text color={C.amber}>{`■ ${s.ask} pending  `}</Text> : null}
            <Text color={s.deny > 0 ? C.warn : C.dim}>{`✗ ${s.deny} denied`}</Text>
            {w >= 80 && g.recent.some(c => c.inSubagent) ? <Text color={C.faint}>{'  dim: in subagents'}</Text> : null}
          </Text>
          <Box columnGap={2}>
            {(['file', 'shell', 'other'] as const).map((b: Bucket) => {
              const tl = g.totals[b]
              const n = tl.rule + tl.ask + tl.cleared + tl.deny
              return (
                <Button
                  key={`gate-${b}`}
                  plain
                  hotkey={b[0]}
                  label={`${b} ${n}${open === b ? ' ▾' : ''}`}
                  dimColor={n === 0}
                  onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
                />
              )
            })}
          </Box>
          {open
            ? g.recent
                .filter(c => c.bucket === open)
                .slice(-5)
                .map(c => (
                  <Text wrap="truncate">
                    <Text color={verdictColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                    <Text color={C.dim}>{`${(c.verdict === 'rule' ? 'allowed' : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? 'pending' : 'denied').padEnd(10)} `}</Text>
                    <Text dimColor={c.inSubagent}>{shorten(c.detail, Math.max(10, w - 18))}</Text>
                  </Text>
                ))
            : null}
        </Box>
      )
    }

    // ---- agents: a swimlane per agent off one trunk; a lane pressed opens its agent's card under it
    const verdictColors: Record<ReviewVerdict, string> = { BLOQUANT: C.warn, MINEUR: C.amber, OK: C.gate }
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')
    // The card's `inspect` turns the pane to its agent's conversation.
    const openOnPress = (c: AgentCard) => () => openAgent($, c)
    // A lane's title opens its card, or closes it when it is the one open.
    const laneOnPress = (id: string) => () =>
      update($, view, x => {
        const y = normalize(DEFAULT_VIEW, x)
        return { ...y, lane: y.lane === id ? null : id }
      })
    const openLane = v.lane && cards.some(c => c.id === v.lane) ? v.lane : null

    const agentsPanel = (w: number) => {
      // A frame like the other panels', in the agents' colour: everything inside is laid out on
      // its inner width (2 border cells, 2 of padding).
      const frame = (...content: (JSX.Element | null)[]) => (
        <Box key="agents-frame" flexDirection="column" borderStyle="round" borderColor={C.agent} paddingX={1} width={w}>
          {content}
        </Box>
      )
      const iw = Math.max(1, w - 4)
      // The title truncates rather than run past the frame.
      const header = (
        <Box width={iw}>
          <Text color={C.agent} bold wrap="truncate">
            {`agents · ${running.length} running · ${cards.length} total`}
          </Text>
        </Box>
      )
      if (cards.length === 0) {
        return frame(header, <Text color={C.faint}>no subagents yet</Text>)
      }
      // Every agent kept, in the tree's order (each sub-agent right after its parent), one row each
      // beside one trunk that starts under the header; the lane opened takes its card's rows too.
      const tree = agentTree(cards)
      const heights = laneHeights(
        tree.map(row => row.card.id),
        openLane,
      )
      const spine = cardSpine(
        tree.map(row => ({ depth: row.depth, active: row.card.status === 'running' })),
        heights,
      )
      const owners = heights.flatMap((h, i) => Array.from({ length: h }, () => i))
      const laneW = Math.max(1, iw - spine.width)
      const cw = Math.max(1, laneW - 4)
      // A lane: ` ◐ `, its title, its time on the shared axis, its clock (5 cells at most).
      const titleW = Math.max(8, Math.min(32, Math.floor((laneW - 10) * 0.45)))
      const barW = Math.max(4, laneW - 3 - titleW - 2 - 5)
      const geo = timeBars(
        tree.map(row => row.card),
        now,
        barW,
      )
      const trunk = motion ? (
        <els.Client
          key="spine"
          module="./spine.tsx"
          width={spine.width}
          height={spine.rows.length}
          props={{ rows: spine.rows, color: C.agent, dim: C.dim }}
        />
      ) : (
        <Box flexDirection="column" width={spine.width} flexShrink={0}>
          {spine.rows.map((row, k) => {
            const c = tree[owners[k] ?? -1]?.card
            return <Text color={c ? statusColor(c) : C.faint}>{row.prefix}</Text>
          })}
        </Box>
      )
      // The card of the lane opened: its title and `inspect`, type and model (and a review
      // agent's verdict), context, state and clock, messages. CARD_ROWS tall, as the trunk counts.
      const card = (c: AgentCard, parent: AgentCard | null) => {
        const isViewed = viewed === c.id
        const isMax = c.lastStop === 'max_tokens'
        // A message just sent or received: the border in amber for FLASH_MS.
        const flash = isFlashing(c, now)
        const stats = cardStatsRow(c, windowFor(c.model, wins, u.window), cw)
        const inspect = 'inspect ›'
        return (
          <Box
            key={`agent-${c.id}`}
            flexDirection="column"
            borderStyle={isViewed ? 'double' : 'round'}
            borderColor={isMax ? C.warn : flash ? C.amber : C.agent}
            borderDimColor={c.status !== 'running' && !isViewed && !flash}
            width={laneW}
            paddingX={1}
            flexShrink={0}
          >
            {/* Cut in cells, then held to one row: a wide title never wraps the card taller. */}
            <Box key={`card-title-${c.id}`} width={cw} height={1} overflow="hidden" justifyContent="space-between">
              <Text bold wrap="truncate">
                {shortenCells(cardTitle(c), Math.max(1, cw - cellWidth(inspect) - 1))}
              </Text>
              <Box flexShrink={0} marginLeft={1}>
                <Button key={`card-inspect-${c.id}`} plain label={inspect} onPress={openOnPress(c)} />
              </Box>
            </Box>
            {/* A row of its own: its type and model, and at its right end a review agent's verdict. */}
            <Box key={`card-kind-${c.id}`} justifyContent="space-between" width={cw}>
              <Text color={C.dim} wrap="truncate">
                {cardKind(c, parent, c.verdict ? cw - cellWidth(c.verdict) - 1 : cw)}
              </Text>
              {c.verdict ? (
                <Box key={`card-verdict-${c.id}`} flexShrink={0}>
                  <Text color={verdictColors[c.verdict]} bold={c.verdict === 'BLOQUANT'}>
                    {c.verdict}
                  </Text>
                </Box>
              ) : null}
            </Box>
            {/* Its context against its window (inferred: `~`), output, steps and compactions. */}
            <Box key={`card-stats-${c.id}`} width={cw} height={1} overflow="hidden">
              <Text dimColor>{stats.lead}</Text>
              {stats.on ? <Text color={stats.level === 'full' ? C.warn : stats.level === 'high' ? C.amber : C.agent}>{stats.on}</Text> : null}
              {stats.off ? <Text color={C.faint}>{stats.off}</Text> : null}
              {stats.tail ? <Text dimColor>{stats.tail}</Text> : null}
              {stats.comp ? <Text color={C.amber}>{stats.comp}</Text> : null}
            </Box>
            <Box>
              {/* The clock takes at most 5 cells (12h59) after the state. */}
              <Text color={isMax ? C.warn : statusColor(c)}>{shortenCells(`${glyph(c)} ${isMax ? 'max_tokens' : c.status}`, Math.max(1, cw - 6)) + ' '}</Text>
              <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
            </Box>
            <Box key={`card-mail-${c.id}`} width={cw}>
              <Text color={flash ? C.amber : C.dim} wrap="truncate">
                {shortenCells(cardMail(c), cw)}
              </Text>
            </Box>
          </Box>
        )
      }
      return frame(
        header,
        <Box>
          {trunk}
          <Box flexDirection="column" width={laneW}>
            {tree.map(({ card: c, parent }, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              const isOpen = openLane === c.id
              const isMax = c.lastStop === 'max_tokens'
              const flash = isFlashing(c, now)
              const color = isMax ? C.warn : statusColor(c)
              return (
                <Box key={`lane-${c.id}`} flexDirection="column" width={laneW} flexShrink={0}>
                  {/* One row, whatever the title: cut in cells, then held to it. */}
                  <Box key={`lane-row-${c.id}`} width={laneW} height={1} overflow="hidden">
                    {/* A message just sent or received: the glyph in amber for FLASH_MS. */}
                    <Text color={flash ? C.amber : color} bold={isViewed || isOpen}>{` ${isOpen ? '▾' : isViewed ? '▶' : glyph(c)} `}</Text>
                    <Box key={`lane-title-${c.id}`} width={titleW} flexShrink={0} overflow="hidden">
                      <Button
                        key={`lane-${c.id}-title`}
                        plain
                        label={shortenCells(cardTitle(c), titleW)}
                        onPress={laneOnPress(c.id)}
                      />
                    </Box>
                    <Text color={C.faint}>{' ' + '·'.repeat(gm?.before ?? 0)}</Text>
                    <Text color={color}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                    <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0) + ' '}</Text>
                    <Box flexShrink={0}>{clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                  {isOpen ? card(c, parent) : null}
                </Box>
              )
            })}
          </Box>
        </Box>,
      )
    }

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const active = lp.filter(l => isLoopActive(l, now)).length
      const dots = lp.slice(-Math.max(4, w - 38))
      return (
        <Box width={w}>
          <Text bold>other loops </Text>
          <Text dimColor>{`${lp.length} seen · ${active} active  `}</Text>
          {dots.map(l => (
            <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
          ))}
        </Box>
      )
    }

    // ---- receipt: the turn now, or the last one
    const receiptPanel = (w: number) => {
      const isReview = t.isReviewing
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.main} borderDimColor={!m.isRunning && !isReview} paddingX={1} width={w}>
          {m.isRunning ? (
            <Box>
              <Text color={C.main} wrap="truncate">{`◐ back to ${modelName.toLowerCase()} · turn `}</Text>
              <Box flexShrink={0}>{clock('turn-clock', t.startedAt, null, C.main)}</Box>
              {w >= 60 ? <Text dimColor wrap="truncate">{` · ${plural(t.edits, 'edit')} · ${plural(t.errors, 'error')}`}</Text> : null}
            </Box>
          ) : r ? (
            <Text wrap="truncate">
              <Text color={r.reason === 'answer' ? C.gate : C.warn}>{r.reason === 'answer' ? '✓ ' : '✗ '}</Text>
              <Text>{`last turn ${fmtDuration(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}`}</Text>
              {cfg.cost && r.costDelta !== null ? <Text color={C.main}>{` · +${fmtUsd(r.costDelta)}`}</Text> : null}
            </Text>
          ) : (
            <Text color={C.faint}>no turn finished yet</Text>
          )}
          {isReview ? <Text color={C.arch}>{`${cfg.architectLabel.toLowerCase()} reviewing before done (inferred)`}</Text> : null}
        </Box>
      )
    }

    // ---- log: whatever rows the other panels leave, 4 to 8
    // Clawd heads the pane (not inline, nor in a pane narrower than he can stand in): his 3 rows come from the log.
    const showMascot = cfg.mascot && e.props.bodyColumns >= 40
    const used =
      2 +
      5 +
      (showArchitect ? 6 : 0) +
      6 +
      (v.gateOpen ? 5 : 0) +
      (panels.includes('agents') ? agentsRows(cards.length, openLane !== null) : 0) +
      (lp.length ? 1 : 0) +
      3 +
      (showMascot ? 3 : 0)
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const nLog = logRows(bodyRows, used)
    const shownLines = (viewed ? lines.filter(l => l.agentId === viewed) : lines).slice(-nLog)
    const colorOf = (l: LogLine) =>
      l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.kind === 'message' ? C.amber : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent
    const logPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={w}>
        <Text dimColor>{viewed ? 'session log · this agent' : 'session log'}</Text>
        {shownLines.length === 0 ? <Text color={C.faint}>nothing yet</Text> : null}
        {shownLines.map(l => (
          <Box>
            <Box width={9} flexShrink={0}>
              <Text color={C.faint}>{fmtClock(l.at)}</Text>
            </Box>
            <Box width={13} flexShrink={0}>
              <Text color={colorOf(l)} bold wrap="truncate">
                {l.who}
              </Text>
            </Box>
            <Text color={l.kind === 'error' ? C.warn : C.text} wrap="truncate">
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const draw = (p: Panel, w: number) =>
      p === 'main'
        ? mainPanel(w)
        : p === 'architect'
          ? architectPanel(w)
          : p === 'gate'
            ? gatePanel(w)
            : p === 'agents'
              ? agentsPanel(w)
              : p === 'loops'
                ? loopsPanel(w)
                : p === 'receipt'
                  ? receiptPanel(w)
                  : logPanel(w)

    // Panels with the flow between them; the agents panel's trunk carries its own.
    const column = (ps: Panel[], w: number) => (
      <Box flexDirection="column" width={w}>
        {ps.map((p, i) => {
          const prev = ps[i - 1]
          const link =
            i === 0 || p === 'agents' || prev === 'agents' || p === 'log' || p === 'loops' || prev === 'loops'
              ? null
              : rail(`link-${p}`, p === 'architect' ? advising : m.isRunning, p === 'architect' ? C.arch : C.main, w)
          return (
            <Box flexDirection="column">
              {link}
              {draw(p, w)}
            </Box>
          )
        })}
      </Box>
    )

    // Desktop draws the agents' time axis as SVG under the panels: a bar per card, in the list's order.
    const svgTimeline =
      e.surface !== 'terminal' && cards.length > 0
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            const rowH = 18
            const pxW = 520
            const shown = agentTree(cards).map(row => row.card)
            const geo = timeBars(shown, now, 100)
            const rects = shown
              .map((c, i) => {
                const gm = geo[i]
                const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
                const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
                const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
                const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
                return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
              })
              .join('')
            const svgH = shown.length * rowH + 4
            return (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
                alt={`${cards.length} agents on a time axis`}
                width={pxW}
                height={svgH}
              />
            )
          })()
        : null

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    if (isMini) {
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, 3)
      const counts = ` ${s.rule} allowed · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} pending` : ''} · ${s.deny} denied`
      const strip = g.recent.slice(-Math.max(4, W - cfg.gateLabel.length - 1 - counts.length))
      const mg = u.pct !== null ? gauge(u.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          <Text wrap="truncate">
            <Text color={C.main} bold>
              {modelName}
            </Text>
            <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? ' ● working' : ' ○ idle'}</Text>
            {mg ? <Text dimColor> · ctx </Text> : null}
            {mg ? <Text color={(u.pct ?? 0) >= 80 ? C.warn : C.main}>{mg.on}</Text> : null}
            {mg ? <Text color={C.faint}>{mg.off}</Text> : null}
            {mg ? <Text>{` ${Math.round(u.pct ?? 0)}%`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{` ⟲${u.compactions}`}</Text> : null}
            {cfg.cost && u.costUsd !== null ? <Text dimColor>{` · ${fmtUsd(u.costUsd)}`}</Text> : null}
            {showArchitect ? <Text color={C.arch}>{` · ${cfg.architectLabel.toLowerCase()} ${advising ? 'advising' : a.consults.length}`}</Text> : null}
          </Text>
          {strip.length > 0 ? (
            <Box>
              <Text dimColor>{`${cfg.gateLabel.toLowerCase()} `}</Text>
              {strip.map(c => (
                <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                  {c.verdict === 'deny' ? '✗' : '■'}
                </Text>
              ))}
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box>
              <Text color={statusColor(c)}>{`${glyph(c)} `}</Text>
              <Box width={Math.max(10, W - 30)}>
                <Text wrap="truncate">{cardTitle(c)}</Text>
              </Box>
              <Text dimColor>{c.steps > 0 ? ` ctx ${kTokens(c.ctx)} ` : ' '}</Text>
              {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.faint} wrap="truncate">{`+${cards.length - live.length} more agents · /flightdeck layout compact for all`}</Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor>{`other loops ${lp.length} · ${lp.filter(l => isLoopActive(l, now)).length} active`}</Text> : null}
          {!m.isRunning && r ? (
            <Text dimColor wrap="truncate">
              {`last turn ${fmtDuration(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}${cfg.cost && r.costDelta !== null ? ` · +${fmtUsd(r.costDelta)}` : ''}`}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- Clawd, centred at the top: waves while agents run, blinks while the main loop works, still otherwise
    const clawdSpan = (sp: ClawdSpan) =>
      sp.on === 'lid' ? (
        <Text color={CLAWD_COLORS.eyes} backgroundColor={CLAWD_COLORS.body}>
          {sp.text}
        </Text>
      ) : sp.on === 'eyes' ? (
        <Text color={CLAWD_COLORS.body} backgroundColor={CLAWD_COLORS.eyes}>
          {sp.text}
        </Text>
      ) : (
        <Text color={CLAWD_COLORS.body}>{sp.text}</Text>
      )
    // His own 3 rows, first in the tree: the pane asks for no more rows than it draws.
    // The remote surfaces (the desktop app, the editor, mobile) draw text in a font that does not
    // join block glyphs: there he is an SVG of the same glyphs, still.
    const SvgEl = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const svgClawd = SvgEl ? clawdSvg(CLAWD.default, CLAWD_COLORS.body, CLAWD_COLORS.eyes) : null
    const mascot = showMascot ? (
      <Box justifyContent="center" width={W}>
        {SvgEl && svgClawd ? (
          <SvgEl key="clawd-svg" source={svgClawd.source} alt="Clawd" width={svgClawd.width} height={svgClawd.height} />
        ) : motion ? (
          <els.Client
            key="clawd"
            module="./clawd.tsx"
            width={9}
            height={3}
            props={{ mode: running.length > 0 ? 'agents' : m.isRunning ? 'main' : 'rest', poses: CLAWD, body: CLAWD_COLORS.body, eyes: CLAWD_COLORS.eyes }}
          />
        ) : (
          <Box key="clawd" flexDirection="column" width={9} flexShrink={0}>
            {CLAWD.default.map(row => (
              <Box>{row.map(clawdSpan)}</Box>
            ))}
          </Box>
        )}
      </Box>
    ) : null

    // ---- the agent view: one agent's conversation in place of the dashboard, read by the hooks
    // (a render may not write state). Never in the mini summary; a card gone (evicted) leaves it.
    const agentView = (card: AgentCard) => {
      const f = feed?.agentId === card.id ? feed : null
      const isSummary = v.expanded === card.id
      const label = isSummary ? 'summary ▾' : 'summary ▸'
      const stateColor = statusColor(card)
      const heading = agentHeading(cardTitle(card), `${glyph(card)} ${card.status} · ${shortModel(card.model)}`, W)
      const hasPrev = neighbourAgent(cards, card.id, -1) !== null
      const hasNext = neighbourAgent(cards, card.id, 1) !== null
      // Read again at the press: the list may have changed since this drawing.
      const step = (dir: -1 | 1) => async () => {
        const fresh = await getCards($)
        const id = neighbourAgent(fresh, card.id, dir)
        const to = id ? fresh.find(c => c.id === id) : undefined
        if (to) await openAgent($, to, false)
      }
      const toggleSummary = () =>
        update($, view, x => {
          const y = normalize(DEFAULT_VIEW, x)
          return { ...y, expanded: y.expanded === card.id ? null : card.id }
        })

      // The card's summary (the `i` key): its task in full, parent, latest calls, the start of its report.
      const summary = isSummary ? (
        <Box key="agent-summary-box" flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={W}>
          <Text bold wrap="wrap">
            {card.description || card.type}
          </Text>
          <Text dimColor wrap="truncate">{`${card.type} · ${prettyModel(card.model)} · ${card.status} · ${plural(card.steps, 'step')}`}</Text>
          <Text dimColor wrap="truncate">{`parent: ${shorten(parentLabel(card, cards, a.ids, cfg.architectLabel.toLowerCase()), Math.max(10, W - 12))}`}</Text>
          {card.tools.length === 0 ? <Text color={C.faint}>no tool calls yet</Text> : null}
          {card.tools.map(n => (
            <Text color={n.isError ? C.warn : C.text} wrap="truncate">
              {`${n.isError ? '✗' : '·'} ${n.text}`}
            </Text>
          ))}
          {card.answer ? (
            <Text dimColor wrap="wrap">
              {`» ${shorten(card.answer, 240)}`}
            </Text>
          ) : null}
        </Box>
      ) : null

      const conversation =
        !f || (f.readAt === 0 && !f.deny && f.entries.length === 0) ? (
          <Text color={C.faint}>reading…</Text>
        ) : f.entries.length === 0 ? (
          <Text color={f.deny ? C.warn : C.faint} wrap="wrap">
            {f.deny ? `transcript unavailable: ${f.deny}` : 'no messages yet'}
          </Text>
        ) : (
          <Box flexDirection="column" width={W}>
            {f.omitted > 0 ? <Text color={C.faint}>{`… ${plural(f.omitted, 'earlier message')}`}</Text> : null}
            {f.entries.map((msg, i) => (
              <Box key={`feed-${i}`} flexDirection="column" width={W}>
                {msg.role === 'assistant' ? (
                  <Text color={C.agent} bold>
                    ◆ assistant
                  </Text>
                ) : (
                  <Text color={C.dim}>▶ user</Text>
                )}
                {msg.text ? (
                  <Text color={msg.role === 'user' ? C.dim : C.text} wrap="wrap">
                    {msg.text}
                  </Text>
                ) : null}
                {msg.toolsOmitted ? <Text color={C.faint}>{`… (+${plural(msg.toolsOmitted, 'tool call')})`}</Text> : null}
                {msg.tools.map((tool, k) => (
                  <Box key={`feed-${i}-tool-${k}`} flexDirection="column" width={W}>
                    <Text color={tool.isError ? C.warn : C.text} wrap="truncate">
                      {shortenCells(`${tool.isError ? '✗' : '⚒'} ${tool.text}`, W)}
                    </Text>
                    {tool.result.map(l => (
                      <Text color={tool.isError ? C.warn : C.dim} wrap="truncate">
                        {`  ${shortenCells(l, W - 2)}`}
                      </Text>
                    ))}
                    {tool.more > 0 ? <Text color={C.faint}>{`  ${shortenCells(`… (+${plural(tool.more, 'line')})`, W - 2)}`}</Text> : null}
                    {tool.isPending ? <Text color={C.faint}>  …</Text> : null}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )

      // Clawd first, as on the dashboard; then the controls (each Button draws its hotkey before
      // its label: `b: back`, 3 cells more), the heading, the summary and the conversation.
      return (
        <Box flexDirection="column" width={W}>
          {mascot}
          <Box key="agent-nav" width={W} justifyContent="space-between">
            <Box columnGap={1} flexShrink={0}>
              <Button key="agent-back" plain hotkey="b" autoFocus label="back" onPress={() => closeAgentView($, true)} />
              <Button key="agent-prev" plain hotkey="p" label="‹ prev" dimColor={!hasPrev} onPress={step(-1)} />
              <Button key="agent-next" plain hotkey="n" label="next ›" dimColor={!hasNext} onPress={step(1)} />
            </Box>
            <Box flexShrink={0} marginLeft={1}>
              <Button key="agent-summary" plain hotkey="i" label={label} onPress={toggleSummary} />
            </Box>
          </Box>
          <Box key="agent-heading" width={W} height={1} overflow="hidden">
            <Text color={C.agent} bold wrap="truncate">
              {heading.head}
            </Text>
            {heading.tail ? (
              <Box flexShrink={0}>
                <Text color={stateColor}>{heading.tail}</Text>
              </Box>
            ) : null}
          </Box>
          {summary}
          <Text color={C.faint}>{'─'.repeat(W)}</Text>
          {conversation}
          {f && f.readAt > 0 && (f.entries.length > 0 || !f.deny) ? (
            <Text color={C.faint} wrap="truncate">
              {`read ${fmtClock(f.readAt)}${f.source === 'transcript' ? ' · from the saved transcript' : ''}`}
            </Text>
          ) : null}
          {/* Back at the end too, for a long conversation read to its bottom (no hotkey: b is the top one's). */}
          <Text color={C.faint}>{'─'.repeat(W)}</Text>
          <Box key="agent-nav-bottom" width={W} columnGap={1}>
            <Button key="agent-back-bottom" plain label="‹ back" onPress={() => closeAgentView($, true)} />
            <Button key="agent-prev-bottom" plain label="‹ prev" dimColor={!hasPrev} onPress={step(-1)} />
            <Button key="agent-next-bottom" plain label="next ›" dimColor={!hasNext} onPress={step(1)} />
          </Box>
        </Box>
      )
    }
    const inView = v.agent ? cards.find(c => c.id === v.agent) : undefined
    if (inView) return agentView(inView)

    const legend = fitLegend(
      [
        { label: 'main', color: C.main },
        { label: 'agents', color: C.agent },
        { label: cfg.gateLabel.toLowerCase(), color: C.gate },
        ...(showArchitect ? [{ label: cfg.architectLabel.toLowerCase(), color: C.arch }] : []),
      ],
      W,
    )

    const body = isWide ? (
      <Box flexDirection="column">
        <Box columnGap={2}>
          {column(panels.filter(p => p === 'main' || p === 'architect' || p === 'gate'), colW)}
          {column(panels.filter(p => p === 'agents' || p === 'loops' || p === 'receipt'), colW)}
        </Box>
        {panels.includes('log') ? logPanel(W) : null}
      </Box>
    ) : (
      column(panels, W)
    )

    return (
      <Box flexDirection="column" width={W}>
        {mascot}
        <Box justifyContent="center">
          <Text bold wrap="truncate">
            <Text color={C.main}>{modelName.toUpperCase()}</Text>
            <Text>{m.isRunning ? ' WORKS' : ' IDLE'}</Text>
            {showArchitect ? <Text color={C.dim}> · </Text> : null}
            {showArchitect ? <Text color={C.arch}>{cfg.architectLabel}</Text> : null}
            {showArchitect ? <Text>{advising ? ' ADVISING' : ' ON CALL'}</Text> : null}
          </Text>
        </Box>
        <Box justifyContent="center" columnGap={2}>
          {legend.map(l => (
            <Text>
              <Text color={l.color}>■</Text>
              <Text dimColor>{` ${l.label}`}</Text>
            </Text>
          ))}
        </Box>
        {body}
        {svgTimeline}
      </Box>
    )
  })
}
