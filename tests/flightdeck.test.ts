import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_TURN,
  afterCall,
  agentTree,
  applyStep,
  consultTimeline,
  describeInput,
  endConsult,
  fitLegend,
  gateSummary,
  lanes,
  limitLabel,
  logRows,
  momentOf,
  normalizeCard,
  parentLabel,
  normalizeGate,
  normalizeLog,
  titleLines,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  CLAWD,
  spineRows,
  redact,
  settleCheck,
  trimRecent,
  startConsult,
} from '../hooks/core'
import type { Check } from '../types'

// ---------------------------------------------------------------- pure behaviour

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
})

const check = (id: string, verdict: Check['verdict'], bucket: Check['bucket'] = 'shell'): Check => ({
  id,
  tool: 'Bash',
  bucket,
  verdict,
  inSubagent: false,
  detail: 'Bash → ls',
  at: 1,
})

test('an ask is settled by the call that follows: cleared if it ran, deny if refused', () => {
  let g = recordCheck(DEFAULT_GATE, check('a', 'ask'))
  g = recordCheck(g, check('b', 'ask'))
  g = recordCheck(g, check('c', 'rule', 'file'))
  g = settleCheck(g, 'a', true)
  g = settleCheck(g, 'b', false)
  g = settleCheck(g, 'zzz', true) // not an ask: unchanged
  const s = gateSummary(g)
  expect([s.rule, s.ask, s.cleared, s.deny, s.total]).toEqual([1, 0, 1, 1, 3])
  expect(g.recent.map(c => c.verdict)).toEqual(['cleared', 'deny', 'rule'])
})

test('the gate tallies a mixed run of verdicts per family', () => {
  let g = DEFAULT_GATE
  g = recordCheck(g, check('r1', 'rule', 'file'))
  g = recordCheck(g, check('a1', 'ask', 'shell'))
  g = recordCheck(g, check('a2', 'ask', 'shell'))
  g = recordCheck(g, check('d1', 'deny', 'other'))
  g = settleCheck(g, 'a1', true)
  g = settleCheck(g, 'a2', false)
  expect(g.totals.file).toEqual({ rule: 1, ask: 0, cleared: 0, deny: 0 })
  expect(g.totals.shell).toEqual({ rule: 0, ask: 0, cleared: 1, deny: 1 })
  expect(g.totals.other.deny).toBe(1)
  expect(gateSummary(g)).toEqual({ rule: 1, ask: 0, cleared: 1, deny: 2, total: 4 })
  expect(gateSummary(DEFAULT_GATE).total).toBe(0)
})

test('a v1-shaped gate reads as empty, then records normally', () => {
  const g = normalizeGate({ file: { allow: 3, ask: 1, deny: 0, cleared: 2 }, shell: null })
  expect(gateSummary(g).total).toBe(0)
  const next = recordCheck(g, check('n1', 'rule', 'file'))
  expect(next.totals.file.rule).toBe(1)
  expect(next.recent.length).toBe(1)
})

test('a pending ask is never trimmed out before it settles', () => {
  let g = recordCheck(DEFAULT_GATE, check('old-ask', 'ask'))
  for (let i = 0; i < 120; i += 1) g = recordCheck(g, check(`r${i}`, 'rule', 'file'))
  expect(g.recent.length).toBe(80)
  expect(g.recent.some(c => c.id === 'old-ask')).toBe(true)
  g = settleCheck(g, 'old-ask', true)
  expect(gateSummary(g).ask).toBe(0)
  expect(trimRecent([check('a', 'rule'), check('b', 'rule')], 5).length).toBe(2)
})

test('edits count from every loop; errors only from the main loop', () => {
  const t = { ...DEFAULT_TURN, errorStreak: 1 }
  expect(afterCall(t, { inSubagent: true, hasFailed: false, isEdit: true }).edits).toBe(1)
  expect(afterCall(t, { inSubagent: true, hasFailed: true, isEdit: false }).errorStreak).toBe(1)
  expect(afterCall(t, { inSubagent: false, hasFailed: true, isEdit: false })).toEqual({ ...t, errorStreak: 2, errors: 1 })
  expect(momentOf(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: false, isEdit: true }))).toBe('before done')
  expect(momentOf({ edits: 0, errorStreak: 2 })).toBe('error repeats')
})

test("a card's context is its latest step's whole input; output adds up", () => {
  let c = normalizeCard({ id: 'x' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, output_tokens: 500 }, stopReason: 'tool_use' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40_000, output_tokens: 700 }, stopReason: 'max_tokens' })
  expect([c.ctx, c.out, c.steps, c.lastStop, c.model]).toEqual([40_005, 1200, 2, 'max_tokens', 'claude-sonnet-5-5'])
})

test('consults open, close by id, and draw on a shared timeline', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 's1', at: 0, moment: 'before a plan', via: 'advisor tool' })
  a = startConsult(a, { id: 's1', at: 5, moment: 'before a plan', via: 'again' }) // same id: ignored
  a = endConsult(a, 10, null, 's1')
  a = startConsult(a, { id: 's2', at: 90, moment: 'before done', via: 'advisor tool' })
  expect(a.consults.length).toBe(2)
  expect(a.consults[0]?.endAt).toBe(10)
  const tl = consultTimeline(a, 100, 11)
  expect(tl.length).toBe(11)
  expect(tl.startsWith('◆━')).toBe(true)
  expect(tl.split('◆').length - 1).toBe(2)
})

test('config is read leniently: bad values fall back to defaults', () => {
  const d = parseConfig({})
  expect([d.maxCards, d.layout, d.motion, d.moments, d.panels.length]).toEqual([3, 'auto', true, true, 7])
  expect(d.architect.test('fable-advisor:fable-advisor')).toBe(true)
  expect([d.mascot, parseConfig({ mascot: 'off' }).mascot, parseConfig({ mascot: 'nope' }).mascot]).toEqual([true, false, true])
  const c = parseConfig({ architectPattern: '([', maxCards: 99, layout: 'diagonal', panels: 'log, gate ,nope,gate', motion: 'off' })
  expect(c.architect.test('advisor')).toBe(true) // invalid regex → default
  expect([c.maxCards, c.layout, c.motion]).toEqual([6, 'auto', false])
  expect(c.panels).toEqual(['log', 'gate'])
})

test('state saved under an older shape still reads', () => {
  expect(normalizeLog([{ at: '08:00:00', who: 'jev', text: 'x' }])[0]).toEqual({ at: 0, who: 'jev', text: 'x', agentId: null, kind: 'info' })
  const g = normalizeGate({ file: { allow: 1 } }) // v1 gate shape
  expect(g.recent).toEqual([])
  expect(g.totals.shell.rule).toBe(0)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
})

test('layout math: lanes share one axis, the log gets 4-8 rows, the legend never wraps', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = lanes(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect([logRows(10, 40), logRows(50, 40), logRows(200, 40)]).toEqual([4, 7, 8])
  expect(fitLegend([{ label: 'main' }, { label: 'agents' }, { label: 'architect' }], 20).map(x => x.label)).toEqual(['main', 'agents'])
  expect(limitLabel('five_hour')).toBe('5h')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(prettyModel('z-ai/glm-5.3-flash-with-a-long-name')).toBe('z-ai/glm-5.3-flash-wi…')
  expect(prettyModel('')).toBe('—')
  expect(promptLine('fix the parser')).toEqual({ who: 'you', text: 'fix the parser' })
  const hb = '<agent-message from="a1940a83d593229d5">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Add gate tests: redaction edge cases.\n  - more\n</agent-message>'
  expect(handbackOf(hb)).toEqual({ from: 'a1940a83d593229d5', body: 'Add gate tests: redaction edge cases.' })
  expect(handbackOf('<agent-message from="x">\nPlain report line\n</agent-message>')).toEqual({ from: 'x', body: 'Plain report line' })
  expect(handbackOf('fix the parser')).toBe(null)
  expect(adviceLine('## Ship it after one more gate test.\n- details')).toBe('Ship it after one more gate test.')
  expect(adviceLine('[Subagent hand-back] header\n\n**Fix card overflow first**')).toBe('Fix card overflow first')
  expect(adviceLine('')).toBe('')
  expect(promptLine('<agent-message from="a1492260715f3be7b"> [Subagent hand-back]')).toEqual({ who: 'engine', text: 'agent message from a1492260' })
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 5 }, { durationMs: 1, agentsSince: 0, costNow: 5, reason: 'answer' }).costDelta).toBe(null)
  expect(titleLines('Write tinyqueue test suite', 13, 16)).toEqual(['Write', 'tinyqueue test…'])
  expect(titleLines('Short', 13, 16)).toEqual(['Short', ''])
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 1, edits: 2 }, { durationMs: 1000, agentsSince: 3, costNow: 1.5, reason: 'answer' }).costDelta).toBe(0.5)
})

const node = (id: string, parentId: string | null = null, description = id) => ({ ...normalizeCard({}), id, parentId, description })

test('agents form a tree: children follow their parent, spawn order kept, prefixes drawn per level', () => {
  const tree = agentTree([
    node('a'),
    node('b'),
    node('a1', 'a'),
    node('a2', 'a'),
    node('a1x', 'a1'),
    node('a2x', 'a2'),
    node('c'),
  ])
  expect(tree.map(r => r.card.id)).toEqual(['a', 'a1', 'a1x', 'a2', 'a2x', 'b', 'c'])
  expect(tree.map(r => r.depth)).toEqual([0, 1, 2, 1, 2, 0, 0])
  // The main loop is the root: its children branch off the trunk too, the last one with └─.
  expect(tree.map(r => r.prefix)).toEqual(['├─', '│ ├─', '│ │ └─', '│ └─', '│   └─', '├─', '└─'])
  expect(tree.map(r => r.parent?.id ?? null)).toEqual([null, 'a', 'a1', 'a', 'a2', null, null])
  expect(agentTree([])).toEqual([])
})

test('an agent whose parent has no card (an architect, an evicted card) is drawn at the top level', () => {
  const tree = agentTree([node('x', 'gone'), node('y'), node('x1', 'x')])
  expect(tree.map(r => [r.card.id, r.depth, r.prefix])).toEqual([
    ['x', 0, '├─'],
    ['x1', 1, '│ └─'],
    ['y', 0, '└─'],
  ])
  // A loop in the links cannot happen, but must not hang or drop a card.
  const loop = agentTree([node('p', 'q'), node('q', 'p'), node('s', 's')])
  expect(loop.map(r => r.card.id).sort()).toEqual(['p', 'q', 's'])
})

test('the lanes trunk: one column of equal-width rows, cut to 6 cells, lit only on the way to a running agent', () => {
  const { rows, width } = spineRows([
    { prefix: '│', active: false }, // the "+N earlier" row: the trunk runs through it
    { prefix: '├─', active: false },
    { prefix: '│ └─', active: false },
    { prefix: '└─', active: false },
    { prefix: '  └─', active: true },
  ])
  expect(width).toBe(4)
  expect(rows.map(r => r.prefix)).toEqual(['│   ', '├─  ', '│ └─', '└─  ', '  └─'])
  // Down the trunk (column 0) to the parent's branch, then the running child's own branch.
  const lit = rows.map(r => r.flow.map(f => (f ? '#' : '.')).join(''))
  expect(lit).toEqual(['#...', '#...', '#...', '##..', '..##'])
  // Nothing running: nothing lit.
  expect(spineRows([{ prefix: '├─', active: false }, { prefix: '└─', active: false }]).rows.every(r => r.flow.every(f => !f))).toBe(true)
  // The trunk to the parent, the parent's branch, then its own line in column 2; the trunk on to b stays dark.
  const deep = spineRows([
    { prefix: '├─', active: false },
    { prefix: '│ ├─', active: false },
    { prefix: '│ │ └─', active: false },
    { prefix: '│ └─', active: true },
    { prefix: '└─', active: false },
  ])
  expect(deep.rows.map(r => r.flow.map(f => (f ? '#' : '.')).join(''))).toEqual(['##....', '..#...', '..#...', '..##..', '......'])
  // Past 6 cells the trunk and the agent's own branch are kept, the levels between dropped.
  const cut = spineRows([{ prefix: '│ │ │ └─', active: false }])
  expect([cut.width, cut.rows[0]?.prefix]).toEqual([6, '│ │ └─'])
  expect(spineRows([]).width).toBe(0)
})

test("Clawd's poses are the official glyphs: 3 rows of 9 cells, eyes and lids marked", () => {
  const text = (pose: keyof typeof CLAWD, row: number) => (CLAWD[pose][row] ?? []).map(s => s.text).join('')
  expect([text('default', 0), text('default', 1), text('default', 2)]).toEqual([' ▐▛███▛█', '▝▜██████▀', ' ▝▝   ▝▝ '])
  expect([text('armsUp', 0), text('armsUp', 1)]).toEqual(['▗▟▛███▛█▄', ' ▜██████▘'])
  expect(text('blink', 0)).toBe(' ▐▂███▂█')
  expect(text('wink', 0)).toBe('▗▟▛███▂█▄')
  expect(CLAWD.blink[0]?.filter(s => s.on === 'lid').map(s => s.text)).toEqual(['▂', '▂'])
  for (const pose of Object.values(CLAWD)) for (const row of pose) expect(row.reduce((n, s) => n + s.text.length, 0) <= 9).toBe(true)
})

test("a card's parent is named from real ids: main, another card, the architect, or an agent with no card", () => {
  const cards = [node('a', null, 'Implement the parser'), node('b', 'a'), node('c', 'arch1'), node('d', 'evicted')]
  expect(parentLabel(cards[0]!, cards, ['arch1'], 'architect')).toBe('main')
  expect(parentLabel(cards[1]!, cards, ['arch1'], 'architect')).toBe('Implement the parser')
  expect(parentLabel(cards[2]!, cards, ['arch1'], 'architect')).toBe('architect')
  expect(parentLabel(cards[3]!, cards, ['arch1'], 'architect')).toBe('agent')
  expect(normalizeCard({ id: 'old' }).parentId).toBe(null) // state saved before 0.4 reads as a main-loop spawn
  expect(normalizeCard({ id: 'odd', parentId: 42 }).parentId).toBe(null)
})

// ---------------------------------------------------------------- drawing

const engine = (on: On, now = 0) => {
  mock.clock(on, { now })
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const pane = (bodyColumns: number) => ({
  plugin: 'flightdeck',
  component: 'Pane' as const,
  requestId: 'flightdeck',
  props: {
    title: 'Flightdeck',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawnN = 0
const spawn = (subagentType: string, description: string, parentAgentId?: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  ...(parentAgentId ? { parentAgentId } : {}),
})

test('a fresh session draws on every surface and width, empty panels hidden', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /· main$/ })).toBeDefined()
      expect(await ui.find({ text: /session log/ })).toBeDefined()
      expect(await ui.find({ text: /agents ·/ })).toBeUndefined() // no subagents: no agents panel
      expect(await ui.find({ text: /permissions/ })).toBeUndefined() // no checks yet: no gate panel
      await ui.unmount()
    }
  }
})

test('inline above the prompt, the pane is a summary of at most 8 rows', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'm-k1' })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    const root = (await ui.drawn()) as { children?: unknown[] }
    expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
    expect(await ui.find({ text: /\+2 more agents/ })).toBeDefined()
    expect(await ui.find({ text: /1 allowed/ })).toBeDefined()
    expect(await ui.find({ text: /session log/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /look around/ })).toBeUndefined()
  await ui.unmount()
})

test('the header starts with the model: no product label on the pane', async ($, on) => {
  engine(on)
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /FLIGHTDECK/ })).toBeUndefined()
    expect(await ui.find({ text: /^— IDLE$/ })).toBeDefined() // no model yet: the dash, then the state
    await ui.unmount()
  }
})

test('colours come from the theme by default, raw hex only when asked', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const title = await ui.find({ text: /· main$/ })
  expect(title?.props.color).toBe('claude')
  await ui.unmount()
})

test('pastel keeps the fixed dark-terminal colours', { options: { palette: 'pastel' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.find({ text: /· main$/ }))?.props.color).toBe('#7dd3fc')
  await ui.unmount()
})

test('subagents become cards, then swimlanes past the card limit; a card expands on its hotkey', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // differs from main: shown
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const lanesUi = await $.ui.mount({ ...pane(64), surface })
    expect(await lanesUi.find({ text: /4 total/ })).toBeDefined()
    expect(await lanesUi.find({ text: /━/ })).toBeDefined()
    await lanesUi.unmount()
  }
})

test('the server-side advisor is read from assistant rows: consulting, then on call', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'plan it', turnId: 'T2' })
  const row = (content: unknown[]) =>
    $.session
      .append({
        message: { type: 'assistant', role: 'assistant', content: content as never },
        door: 'response',
        origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
        uuid: `u${++spawnN}`,
      })
      .catch(() => undefined) // the test has no transcript to store rows in
  await row([{ type: 'server_tool_use', id: 'srv1', name: 'advisor', input: {} }])
  const mid = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await mid.find({ text: /ARCHITECT · advising/ })).toBeDefined()
  expect(await mid.find({ text: /◆ before a plan/ })).toBeDefined()
  await mid.unmount()

  await row([{ type: 'advisor_tool_result', tool_use_id: 'srv1', content: { type: 'advisor_redacted_result' } }])
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await after.find({ text: /^1$/ })).toBeDefined()
  await after.unmount()
})

test('the gate strip fills from checks and a row opens its redacted drill-down', async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345" api' }, tool_use_id: 'k2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 checks/ })).toBeDefined()
  expect(await ui.find({ text: /1 pending/ })).toBeDefined()
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
  expect(await ui.find({ text: /abcdefgh12345/ })).toBeUndefined()
  await ui.unmount()
})

test('config changes labels, hides panels and turns the moments off', { options: { architectLabel: 'REVIEWER', panels: 'main,architect,agents,log', moments: false } }, async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: `r${++n}` }))
  await $.turn.start({ text: 'review it', turnId: 'T3' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /REVIEWER · advising/ })).toBeDefined()
  expect(await ui.find({ text: /permissions/ })).toBeUndefined()
  expect(await ui.find({ text: /before a plan/ })).toBeUndefined()
  await ui.unmount()
})

test('a consult whose start and result share one row closes, and its review flag with it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'T4' })
  // An edit first, so the consult is inferred as "before done" and sets the review flag.
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.session
    .append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'srv9', name: 'advisor', input: {} },
          { type: 'advisor_tool_result', tool_use_id: 'srv9', content: { type: 'advisor_redacted_result' } },
        ] as never,
      },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'one-row',
    })
    .catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT · on call/ })).toBeDefined()
  expect(await ui.find({ text: /◆ before done/ })).toBeDefined()
  expect(await ui.find({ text: /reviewing before done/ })).toBeUndefined()
  await ui.unmount()
})

test('with no architect anywhere, the panel, legend entry and status field stay hidden', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /ARCHITECT/ })).toBeUndefined()
  expect(await ui.find({ text: /^ architect$/ })).toBeUndefined()
  await ui.unmount()
})

test('cards that cannot fit the pane fall back to lanes', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /━/ })).toBeDefined() // lanes
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(70), surface: 'terminal' })
  expect(await wide.find({ text: /━/ })).toBeUndefined() // three cards fit in 70
  expect(await wide.find({ text: /task gamma/ })).toBeDefined()
  await wide.unmount()
})

test("a background architect's advice is read from its hand-back", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'fab1' }))
  await $.turn.start({ text: 'review it', turnId: 'H1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'H1', agentId: 'fab1', reason: 'answer' })
  await $.turn.start({
    text: '<agent-message from="fab1">\n[Subagent hand-back] The report follows:\n  Ship it after one more gate test.\n</agent-message>',
    turnId: 'H2',
  })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /» Ship it after one more gate test\./ })).toBeDefined()
  await ui.unmount()
})

test('lanes draw the spawn tree: a branch before each sub-agent, its parent in the expanded panel', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `g${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'G1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the docs'))
  await $.agent.spawn(spawn('general-purpose', 'Write parser tests', 'g1'))
  await $.agent.spawn(spawn('Explore', 'Check edge cases', 'g3'))
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /4 total/ })).toBeDefined()
    // One trunk column from the header: every agent branches off it, sub-agents under their parent.
    const spine = await ui.find({ type: 'Client', key: 'spine' })
    const rows = (spine?.props.props as { rows: { prefix: string; active: boolean }[] }).rows
    expect(rows.map(r => r.prefix.trimEnd())).toEqual(['├─', '│ └─', '│   └─', '└─'])
    expect(await ui.find({ in: 'spine', text: /└─/ })).toBeDefined()
    // Parent first, then its line of descent, then the next top-level agent.
    const titles = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => String(k).startsWith('card-'))
    expect(titles).toEqual(['card-g1', 'card-g3', 'card-g4', 'card-g2'])
    await ui.press({ key: 'card-g4' })
    expect(await ui.find({ text: /^parent: Write parser tests$/ })).toBeDefined()
    await ui.press({ key: 'card-g1' })
    expect(await ui.find({ text: /^parent: main$/ })).toBeDefined()
    await ui.press({ key: 'card-g1' }) // closes it again
    await ui.unmount()
  }
})

test("cards name a sub-agent's parent; the rail lights only the branches still running", async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `k${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'K1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites', 'k1'))
  await $.turn.complete({ answer: 'mapped', durationMs: 10, isAborted: false, turnId: 'K1', agentId: 'k2', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /━/ })).toBeUndefined() // two cards fit: no lanes
  expect(await ui.find({ text: /^↳ Implement the… · Explore\b/ })).toBeDefined() // 27 cells inside the card
  for (const key of ['fan-out', 'merge']) {
    const marks = await ui.findAll({ in: key, text: /[┬┴]/ })
    expect(marks.some(m => m.props.color === 'suggestion' && m.props.bold === true)).toBe(true) // k1 runs
    expect(marks.some(m => m.props.color === 'subtle')).toBe(true) // k2 is done
  }
  await ui.unmount()
})

type SpineProps = { rows: { prefix: string; active: boolean; flow: boolean[] }[]; color: string; dim: string }

test('lanes hang every agent off one trunk from the header; packets run only to the agent still running', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `t${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'S1' })
  for (const d of ['alpha', 'beta', 'gamma', 'delta']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  for (const id of ['t1', 't3', 't4']) await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'S1', agentId: id, reason: 'answer' })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const spine = await ui.find({ type: 'Client', key: 'spine' })
    expect(spine).toBeDefined()
    const props = spine?.props.props as SpineProps
    expect(props.rows.map(r => r.prefix)).toEqual(['├─', '├─', '├─', '└─'])
    expect(props.rows.map(r => r.active)).toEqual([false, true, false, false])
    expect([spine?.props.width, spine?.props.height]).toEqual([2, 4])
    // Hotkeys follow the rows as drawn.
    const buttons = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('card-'))
    expect(buttons.map(b => [b.key, b.props.hotkey])).toEqual([
      ['card-t1', '1'],
      ['card-t2', '2'],
      ['card-t3', '3'],
      ['card-t4', '4'],
    ])
    // The axis starts at the same cell on every row: trunk + glyph + title always take 19 cells.
    const titles = (await ui.findAll({ type: 'Box' })).filter(b => String(b.key).startsWith('lane-title-'))
    expect(titles.length).toBe(4)
    for (const t of titles) expect(Number(spine?.props.width) + 3 + Number(t.props.width)).toBe(19)
    for (const b of buttons) expect(String(b.props.label).length <= 13 - Number(spine?.props.width)).toBe(true)
    // A packet runs down the trunk to the running agent's branch; the ended branches stay dim.
    let packets = 0
    for (let step = 0; step < 8; step += 1) {
      await ui.advance(130)
      const lit = await ui.findAll({ in: 'spine', text: /[●•]/ })
      packets += lit.filter(t => t.props.color === 'suggestion' && t.props.bold === true).length
    }
    expect(packets > 0).toBe(true)
    const drawn = await ui.findAll({ in: 'spine', type: 'Text' })
    expect(drawn.some(t => t.props.color === 'inactive' && /├─/.test(t.text))).toBe(true)
    await ui.unmount()
  }
})

test('lanes past six agents: the trunk runs through the "+N earlier" row and hotkeys stay 1-6', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `e${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'E1' })
  for (let i = 1; i <= 8; i += 1) await $.agent.spawn(spawn('Explore', `job ${i}`))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^\+2 earlier$/ })).toBeDefined()
  const props = (await ui.find({ type: 'Client', key: 'spine' }))?.props.props as SpineProps
  expect(props.rows.map(r => r.prefix)).toEqual(['│ ', '├─', '├─', '├─', '├─', '├─', '└─'])
  expect(props.rows.map(r => r.active)).toEqual([false, true, true, true, true, true, true])
  const keys = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('card-')).map(b => b.props.hotkey)
  expect(keys).toEqual(['1', '2', '3', '4', '5', '6'])
  await ui.unmount()
})

test('without motion or a Client, the trunk is drawn still, each branch in its status colour', { options: { motion: 'off' } }, async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `f${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'F1' })
  for (const d of ['alpha', 'beta', 'gamma', 'delta']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'F1', agentId: 'f1', reason: 'answer' })
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ type: 'Client', key: 'spine' })).toBeUndefined()
    const branches = await ui.findAll({ type: 'Text', text: /^[├└]─$/ })
    expect(branches.map(b => b.text)).toEqual(['├─', '├─', '├─', '└─'])
    expect(branches[0]?.props.color).toBe('success') // f1 is done
    expect(branches[1]?.props.color).toBe('suggestion') // f2 runs
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- Clawd

const clockOf = /^(\d\d:\d\d:\d\d|--:--:--)$/

test('Clawd sits at the bottom, centred, in its own colours, and waves while agents run', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'cl1' }))
  await $.turn.start({ text: 'go', turnId: 'CL1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const clawd = await ui.find({ type: 'Client', key: 'clawd' })
  expect([clawd?.props.width, clawd?.props.height]).toEqual([9, 3])
  // The last thing in the pane, centred across its full width.
  const root = (await ui.drawn()) as { children?: { props?: { justifyContent?: string; width?: number }; children?: { props?: { key?: string } }[] }[] }
  const last = (root.children ?? []).filter(Boolean).at(-1)
  expect([last?.props?.justifyContent, last?.props?.width]).toEqual(['center', 64])
  const eyes = await ui.findAll({ in: 'clawd', text: '▛███▛█' })
  expect(eyes.some(t => t.props.color === '#D77757' && t.props.backgroundColor === '#000000')).toBe(true)
  expect(await ui.find({ in: 'clawd', text: /▝▝ {3}▝▝/ })).toBeDefined()
  let armsUp = false
  for (let step = 0; step < 6 && !armsUp; step += 1) {
    await ui.advance(300)
    armsUp = (await ui.find({ in: 'clawd', text: /▗▟/ })) !== undefined
  }
  expect(armsUp).toBe(true)
  await ui.unmount()
})

test('Clawd is drawn still where there is no Client, and not at all inline or under mascot: off', async ($, on) => {
  engine(on)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ key: 'clawd' })).toBeDefined()
    const eyes = await ui.find({ type: 'Text', text: '▛███▛█' })
    expect([eyes?.props.color, eyes?.props.backgroundColor]).toEqual(['#D77757', '#000000'])
    await ui.unmount()
  }
  const mini = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await mini.find({ key: 'clawd' })).toBeUndefined()
  expect(await mini.find({ text: /▛███/ })).toBeUndefined()
  await mini.unmount()
})

test('mascot: off leaves Clawd out', { options: { mascot: 'off' } }, async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ key: 'clawd' })).toBeUndefined()
    expect(await ui.find({ text: /▛███/ })).toBeUndefined()
    await ui.unmount()
  }
})

const logLinesAt = async ($: Engine, on: On, bodyRows: number) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `lg${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'LG1' })
  for (let i = 1; i <= 8; i += 1) await $.agent.spawn(spawn('Explore', `job ${i}`))
  const ui = await $.ui.mount({ ...pane(64), props: { ...pane(64).props, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const count = (await ui.findAll({ type: 'Text', text: clockOf })).length
  await ui.unmount()
  return count
}

// 8 lanes (3 + 6 rows) beside main, gate and the frame: 25 rows used. 34 rows leave the log 6;
// Clawd's 3 rows leave it the floor of 4.
test('Clawd takes its 3 rows from the log, not from the panes below it', async ($, on) => {
  expect(await logLinesAt($, on, 34)).toBe(4)
})

test('without Clawd the log keeps those rows', { options: { mascot: 'off' } }, async ($, on) => {
  expect(await logLinesAt($, on, 34)).toBe(6)
})

test('VS Code and mobile draw no Client: the trunk and the clocks are drawn still there, motion on', async ($, on) => {
  engine(on, 65_000) // a real start time, so each lane has a clock to draw
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `v${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'V1' })
  for (const d of ['alpha', 'beta', 'gamma', 'delta']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text', text: /^[├└]─$/ })).length).toBe(4)
    expect((await ui.findAll({ type: 'Text', text: /^\d+:\d\d$/ })).length).toBe(5) // one per lane, and the turn's
    await ui.unmount()
  }
})
