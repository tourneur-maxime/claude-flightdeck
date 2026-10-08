export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = { model: string; effort: string; mode: string; steps: number; isRunning: boolean }

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  limits: { kind: string; pct: number }[]
  compactions: number
  lastCompactAt: number | null
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

/** A review agent's verdict, as its report words it: a blocker, minor points only, or nothing to fix. */
export type ReviewVerdict = 'BLOQUANT' | 'MINEUR' | 'OK'

export type AgentCard = {
  id: string
  /** The loop that spawned it: another agent's id, or null for the main loop. */
  parentId: string | null
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
  /** The verdict read from its report, for an agent whose task matches `verdictPattern`; null otherwise. */
  verdict: ReviewVerdict | null
  /** Messages it sent (SendMessage, seen at session.send and matched at session.receive). */
  sent: number
  /** Messages it received, from the main loop or another agent. */
  received: number
  /** When it last sent or received one; the card's border flashes for a moment after. */
  lastMessageAt: number | null
  /** Which way that message went: `out` to it (from main or another agent), `in` from it. */
  lastMessageDir: 'in' | 'out' | null
  /** The main loop was told it finished (a task notification naming it). */
  notified: boolean
  /** Times its own transcript was compacted. */
  compactions: number
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done' | 'message'
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

/** expanded: the agent whose summary the agent view shows above its conversation (the `i` key). */
export type View = {
  expanded: string | null
  gateOpen: Bucket | null
  layout: Layout | null
  /** The agent whose conversation the pane shows instead of the dashboard, or null. */
  agent: string | null
  /** The swimlane opened on its agent's card, or null. */
  lane: string | null
}

/** One tool call of an agent's conversation, as the agent view draws it; redacted. */
export type FeedTool = {
  /** `Bash → git status`: describeInput's line. */
  text: string
  isError: boolean
  /** The result's first lines (at most 3), each cut; empty while the call runs. */
  result: string[]
  /** Lines of the result not kept. */
  more: number
  /** No result yet. */
  isPending: boolean
}

/** One message of an agent's conversation; redacted, cut to a size. */
export type FeedEntry = {
  role: 'user' | 'assistant'
  text: string
  tools: FeedTool[]
  /** The message's earliest calls left out to keep it within the budget; absent when none were. */
  toolsOmitted?: number
}

/** The conversation the agent view shows: read in hooks (never while drawing), its end kept within a budget. */
export type AgentFeed = {
  agentId: string
  entries: FeedEntry[]
  /** Messages before the first entry kept, left out by the budget. */
  omitted: number
  readAt: number
  /** session: `$.session.messages`; transcript: the agent's saved JSONL, read when the session no longer serves it. */
  source: 'session' | 'transcript'
  /** Why nothing could be read: the session's refusal, then the transcript's; null once read. */
  deny: string | null
}

export type Roster = { architectTypes: string[] }

declare module 'claude-code' {
  interface PluginState {
    'flightdeck': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      /** Context windows by model id (lower case), learnt from the main loop's measurements. */
      windows: Record<string, number>
      /** The conversation in the agent view, or null when the pane shows the dashboard. */
      agentFeed: AgentFeed | null
    }
  }
}
