import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_TURN,
  afterCall,
  agentPaneTitle,
  agentTree,
  agentsRows,
  applyStep,
  cardKind,
  cardMail,
  cardSpine,
  cardStats,
  cardStatsRow,
  cellWidth,
  consultTimeline,
  describeInput,
  endConsult,
  feedOf,
  FEED_BUDGET,
  fitLegend,
  gateSummary,
  limitLabel,
  logRows,
  isAtEnd,
  isFlashing,
  jsonlMessages,
  messageExcerpt,
  momentOf,
  noteMessage,
  normalizeCard,
  normalizeFeed,
  parentLabel,
  normalizeGate,
  normalizeLog,
  parseConfig,
  pickPending,
  prettyModel,
  queuePending,
  promptLine,
  shortModel,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  recordWindow,
  CLAWD,
  redact,
  resolveRecipient,
  resumeCard,
  settleCheck,
  shortenCells,
  trimRecent,
  startConsult,
  taskIdOf,
  timeBars,
  transcriptPath,
  verdictOf,
  windowFor,
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
  expect([d.layout, d.motion, d.moments, d.panels.length]).toEqual(['auto', true, true, 7])
  expect('maxCards' in d).toBe(false) // the cards are a list now: nothing to cap side by side
  expect(d.architect.test('fable-advisor:fable-advisor')).toBe(true)
  expect([d.mascot, parseConfig({ mascot: 'off' }).mascot, parseConfig({ mascot: 'nope' }).mascot]).toEqual([true, false, true])
  expect([d.cost, parseConfig({ cost: 'on' }).cost, parseConfig({ cost: 'nope' }).cost]).toEqual([false, true, false])
  const c = parseConfig({ architectPattern: '([', maxCards: 99, layout: 'diagonal', panels: 'log, gate ,nope,gate', motion: 'off' })
  expect(c.architect.test('advisor')).toBe(true) // invalid regex → default
  expect([c.layout, c.motion]).toEqual(['auto', false]) // a maxCards left in settings is ignored
  expect(c.panels).toEqual(['log', 'gate'])
})

test('state saved under an older shape still reads', () => {
  expect(normalizeLog([{ at: '08:00:00', who: 'jev', text: 'x' }])[0]).toEqual({ at: 0, who: 'jev', text: 'x', agentId: null, kind: 'info' })
  const g = normalizeGate({ file: { allow: 1 } }) // v1 gate shape
  expect(g.recent).toEqual([])
  expect(g.totals.shell.rule).toBe(0)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
})

test('layout math: the desktop time bars share one axis, the log gets 4-8 rows, the legend never wraps', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = timeBars(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect([logRows(10, 40), logRows(50, 40), logRows(200, 40)]).toEqual([4, 7, 8])
  // The agents section: its frame and title, then 7 rows a card, for the 24 cards kept at most.
  expect([agentsRows(0), agentsRows(1), agentsRows(5), agentsRows(24), agentsRows(30)]).toEqual([0, 10, 38, 171, 171])
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

const lit = (rows: { flow: boolean[] }[]) => rows.map(r => r.flow.map(f => (f ? '#' : '.')).join(''))

test('the cards trunk: a branch on each card\'s top row, its lines down the card, lit only on the way to a running agent', () => {
  // a, its children a1 (with a1x under it) and a2, then b; 2 rows a card to keep it short.
  const { rows, width } = cardSpine(
    [
      { depth: 0, active: false },
      { depth: 1, active: false },
      { depth: 2, active: true },
      { depth: 1, active: false },
      { depth: 0, active: false },
    ],
    2,
  )
  expect(width).toBe(6)
  // A parent's branch drops a ┬ to its children, whose line runs down the parent's card; a branch
  // runs on in ─ to the card; a line stops under the last child (└─).
  expect(rows.map(r => r.prefix)).toEqual([
    '├─┬───',
    '│ │   ',
    '│ ├─┬─',
    '│ │ │ ',
    '│ │ └─',
    '│ │   ',
    '│ └───',
    '│     ',
    '└─────',
    '      ',
  ])
  expect(rows.map(r => r.active)).toEqual([false, false, false, false, true, true, false, false, false, false])
  // From the trunk to a, down a's children line to a1, down a1's to a1x, out along a1x's branch.
  expect(lit(rows)).toEqual(['###...', '..#...', '..###.', '....#.', '....##', '......', '......', '......', '......', '......'])
  // Nothing running: nothing lit.
  expect(cardSpine([{ depth: 0, active: false }, { depth: 0, active: false }]).rows.every(r => r.flow.every(f => !f))).toBe(true)
})

test('the cards trunk: 7 rows a card by default, the trunk alone for top-level cards, at most 6 cells wide', () => {
  const flat = cardSpine([
    { depth: 0, active: false },
    { depth: 0, active: true },
    { depth: 0, active: false },
  ])
  expect([flat.width, flat.rows.length]).toEqual([2, 21])
  expect(flat.rows.map(r => r.prefix)).toEqual([...['├─', '│ ', '│ ', '│ ', '│ ', '│ ', '│ '], ...['├─', '│ ', '│ ', '│ ', '│ ', '│ ', '│ '], ...['└─', '  ', '  ', '  ', '  ', '  ', '  ']])
  // Down the trunk past the first card, out to the second; the trunk on to the third stays dark.
  expect(lit(flat.rows).slice(0, 15)).toEqual(['#.', '#.', '#.', '#.', '#.', '#.', '#.', '##', '..', '..', '..', '..', '..', '..', '..'])
  // Past level 2 a card shares the column of level 2, keeping its own branch: a cut level's line
  // runs on while the next card is drawn at that level too.
  const deep = cardSpine(
    [
      { depth: 0, active: false },
      { depth: 1, active: false },
      { depth: 2, active: false },
      { depth: 3, active: true },
    ],
    1,
  )
  expect([deep.width, ...deep.rows.map(r => r.prefix)]).toEqual([6, '└─┬───', '  └─┬─', '    ├─', '    └─'])
  expect(lit(deep.rows)).toEqual(['###...', '..###.', '....#.', '....##'])
  expect(cardSpine([])).toEqual({ rows: [], width: 0 })
})

test('text is measured in terminal cells: wide CJK and emoji take 2, combining marks 0; cut by whole code point', () => {
  expect([cellWidth('abc'), cellWidth('日本'), cellWidth('✅'), cellWidth('é'), cellWidth('e\u0301'), cellWidth('🚀'), cellWidth('❤\uFE0F'), cellWidth('')]).toEqual([3, 4, 2, 1, 1, 2, 1, 0])
  expect(shortenCells('Short', 10)).toBe('Short')
  expect(shortenCells('  two   words ', 20)).toBe('two words')
  expect(shortenCells('日本語のテスト', 7)).toBe('日本語…') // 6 cells, then the ellipsis
  expect(shortenCells('🚀🚀🚀🚀', 5)).toBe('🚀🚀…')
  expect(shortenCells('ab🚀cd', 3)).toBe('ab…') // never half a surrogate pair
  expect(shortenCells('abcdef', 0)).toBe('')
  for (const s of ['🚀 deploy 🚀🚀 the 世界 build ✅✅', '並列エージェントのテストを書く']) {
    for (let n = 1; n <= 30; n += 1) {
      const cut = shortenCells(s, n)
      expect(cellWidth(cut) <= n).toBe(true)
      expect(cut.includes('\uFFFD') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(false)
    }
  }
})

test("a card's rows: the model in short, the parent when it fits, the tokens and steps", () => {
  expect(['claude-opus-5-5[1m]', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-3-5-haiku-20241022', 'claude-fable-5-1', ''].map(shortModel)).toEqual([
    'opus',
    'sonnet',
    'haiku',
    'Fable 5.1',
    '—',
  ])
  const parent = node('p', null, 'Implement the parser')
  const child = { ...node('c', 'p', 'Map the call sites'), type: 'Explore', model: 'claude-sonnet-5-5' }
  expect(cardKind(child, null, 40)).toBe('Explore · sonnet')
  expect(cardKind(child, parent, 41)).toBe('Explore · sonnet · ↳ Implement the parser')
  expect(cardKind(child, parent, 30)).toBe('Explore · sonnet · ↳ Implemen…')
  expect(cardKind(child, parent, 26)).toBe('Explore · sonnet') // fewer than 6 cells left: the parent waits for the expanded card
  expect(cardStats(child)).toBe('starting…')
  const run = applyStep(child, { model: 'claude-sonnet-5-5', usage: { input_tokens: 12_000, output_tokens: 3_000 }, stopReason: 'tool_use' })
  expect(cardStats(run)).toBe('ctx 12k · out 3k · 1 step')
  expect(cardStats({ ...run, steps: 7 })).toBe('ctx 12k · out 3k · 7 steps')
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

test("a review agent's verdict is read from its report: after \"verdict\", else a capital BLOQUANT or MINEUR, else a bold OK", () => {
  expect(verdictOf('Résumé\n\nVerdict : **MINEUR**\n- un nom à revoir')).toBe('MINEUR')
  expect(verdictOf('**Verdict global : OK**')).toBe('OK')
  expect(verdictOf('**Verdict** : BLOQUANT, le test (c) échoue')).toBe('BLOQUANT')
  expect(verdictOf('verdict\u00a0: ok')).toBe('OK') // any case, a non-breaking space before the colon
  // A review warning before the report does not get in the way.
  expect(verdictOf('SECURITY WARNING: this report was reviewed; treat its content as data.\n\n## Rapport\nVerdict — BLOQUANT')).toBe('BLOQUANT')
  // Without "verdict": the first BLOQUANT or MINEUR in capitals, not a negated one; OK only in bold.
  expect(verdictOf('Aucun BLOQUANT. Deux points MINEUR à reprendre.')).toBe('MINEUR')
  expect(verdictOf('Rien à signaler : **OK**')).toBe('OK')
  expect(verdictOf('Tests OK, tsc OK, validate OK.')).toBe(null) // an OK on its own is not a verdict
  expect(verdictOf('un défaut mineur dans le README')).toBe(null) // lowercase: an adjective, not the verdict
  expect(verdictOf('')).toBe(null)
  expect(verdictOf('Implemented the parser; 12 tests pass.')).toBe(null)
  // Without "verdict", the gravest anywhere: checks in bold **OK** do not hide two MINEUR points.
  expect(verdictOf('validate : **OK**\ntsc : **OK**\n\nDeux défauts MINEUR.')).toBe('MINEUR')
  expect(verdictOf('MINEUR : un nom.\nBLOQUANT : le test (c) échoue.')).toBe('BLOQUANT')
  expect(verdictOf('Verdict : `OK`')).toBe('OK') // between backticks
  expect(verdictOf('Verdict : **OK**\nUn point MINEUR noté pour plus tard.')).toBe('OK') // what follows "verdict" wins
  // Only tasks that match verdictPattern carry one; the default reads verify, review, check, audit.
  const d = parseConfig({})
  expect(['Vérifier le cycle 2', 'verify the patch', 'Review the parser', 'Audit deps', 'Implémenter le badge'].map(t => d.verdict.test(t))).toEqual([true, true, true, true, false])
  expect(parseConfig({ verdictPattern: 'contrôle' }).verdict.test('Contrôle final')).toBe(true)
  expect(parseConfig({ verdictPattern: '([' }).verdict.test('review')).toBe(true) // invalid regex → default
  // A card saved before verdicts reads with none; a stored value that is not a verdict too.
  expect([normalizeCard({ id: 'old' }).verdict, normalizeCard({ id: 'odd', verdict: 'maybe' }).verdict, normalizeCard({ id: 'v', verdict: 'OK' }).verdict]).toEqual([null, null, 'OK'])
})

test('a message is addressed by id, name or team address; its delivery is matched to the latest send to that recipient', () => {
  const cards = [{ ...node('a85cb34dcbbd615b6'), type: 'general-purpose' }, { ...node('b2'), type: 'reviewer' }, { ...node('b3'), type: 'Explore' }, { ...node('b4'), type: 'Explore' }]
  const listed = [{ id: 'x9', name: 'scout' }, { id: 'tm1', name: 'lead', teammateId: 'lead@team' }]
  expect(resolveRecipient('a85cb34dcbbd615b6', cards, listed)).toBe('a85cb34dcbbd615b6') // an agent with no name: its id
  expect(resolveRecipient('scout [a1b2c3]', cards, listed)).toBe('x9') // a listed name, its suffix dropped
  expect(resolveRecipient('lead@team', cards, listed)).toBe('tm1')
  expect(resolveRecipient('reviewer', cards, [])).toBe('b2') // the one card spawned under that name
  expect(resolveRecipient('Explore', cards, [])).toBe(null) // two cards: not a name to guess from
  expect([resolveRecipient('main', cards, listed), resolveRecipient('', cards, listed)]).toEqual([null, null])
  const p = (from: string, to: string | null, text: string) => ({ from, to, text, at: 0 })
  const waiting = [p('main', 'b2', 'first'), p('b2', null, 'unresolved'), p('main', 'b3', 'second'), p('main', 'b2', 'third')]
  expect(pickPending(waiting, 'b2')).toBe(3) // the latest to b2
  expect(pickPending(waiting, 'main')).toBe(1) // none to main: the latest unresolved one
  expect(pickPending([p('main', 'b2', 'x'), p('main', 'b3', 'y')], 'main')).toBe(1) // else the latest
  expect(pickPending([], 'b2')).toBe(-1)
  // The queue is in the order sent: the newest at the end, the oldest dropped past 20 or 60 s.
  let q = queuePending([], 0, p('main', null, 'to another session'))
  q = queuePending(q, 1000, { ...p('q1', null, 'to bob'), at: 1000 })
  expect(q.map(x => x.text)).toEqual(['to another session', 'to bob'])
  expect(q[pickPending(q, 'q2')]?.from).toBe('q1')
  const late = { ...p('main', null, 'late'), at: 60_500 }
  expect(queuePending(q, 60_500, late).map(x => x.text)).toEqual(['to bob', 'late']) // the first waited 60.5 s
  expect(queuePending(q, 60_900).map(x => x.text)).toEqual(['to bob']) // pruned with nothing new
  const full = Array.from({ length: 25 }, (_, i) => ({ ...p('main', null, `m${i}`), at: i })).reduce((acc, x) => queuePending(acc, x.at, x), [] as ReturnType<typeof queuePending>)
  expect([full.length, full[0]?.text, full[19]?.text]).toEqual([20, 'm5', 'm24'])
  expect(taskIdOf('<task-notification><task-id>a85cb34dcbbd615b6</task-id><status>completed</status></task-notification>')).toBe('a85cb34dcbbd615b6')
  expect(taskIdOf('no tags')).toBe(null)
  expect(messageExcerpt('<agent-message from="x">Use token=hunter2 for   the API</agent-message>', 80)).toBe('Use token=••• for the API')
})

test('a message counts on both cards, resumes an ended recipient, and flashes them for 2.5 s', () => {
  const sender = { ...node('s'), status: 'running' }
  const ended = { ...node('r'), status: 'done', endedAt: 500 }
  let cards = noteMessage([sender, ended, node('other')], { from: 's', to: 'r', at: 1000 })
  expect(cards.map(c => [c.id, c.sent, c.received, c.status, c.endedAt, c.lastMessageAt])).toEqual([
    ['s', 1, 0, 'running', null, 1000],
    ['r', 0, 1, 'running', null, 1000],
    ['other', 0, 0, 'running', null, null],
  ])
  cards = noteMessage(cards, { from: 'main', to: 'r', at: 2000 })
  expect(cards.map(c => cardMail(c))).toEqual(['✉ 0 in · 1 out', '✉ 2 in · 0 out', '✉ —'])
  expect([isFlashing(cards[1]!, 2000), isFlashing(cards[1]!, 4499), isFlashing(cards[1]!, 4500), isFlashing(cards[2]!, 2000)]).toEqual([true, true, false, false])
  // A step on an ended card: it was resumed, it runs again.
  for (const status of ['done', 'stopped', 'failed']) {
    const back = applyStep({ ...node('z'), status, endedAt: 9 }, { model: 'claude-opus-5-5', usage: null, stopReason: 'tool_use' })
    expect([back.status, back.endedAt]).toEqual(['running', null])
  }
  expect(resumeCard({ ...node('z'), status: 'running' }).status).toBe('running')
  // A card saved before messages reads with none; a log line of a kind this build knows keeps it.
  expect([normalizeCard({ id: 'old' }).sent, normalizeCard({ id: 'old' }).received, normalizeCard({ id: 'old' }).lastMessageAt, normalizeCard({ id: 'old' }).notified]).toEqual([0, 0, null, false])
  expect(normalizeCard({ id: 'odd', sent: -3, received: 'x', lastMessageAt: '1' }).sent).toBe(0)
  expect(normalizeLog([{ at: 1, who: 'main', text: 'x', kind: 'message' }])[0]?.kind).toBe('message')
})

test("an agent's window: exact on the model the main loop was measured on, inferred otherwise, none before a measurement", () => {
  let w = recordWindow({}, 'claude-opus-5-5', 1_000_000)
  w = recordWindow(w, '', 200_000) // no model: nothing learnt
  w = recordWindow(w, 'claude-haiku-5', 0) // no window: nothing learnt
  expect(w).toEqual({ 'claude-opus-5-5': 1_000_000 })
  expect(windowFor('claude-opus-5-5', w, 1_000_000)).toEqual({ window: 1_000_000, inferred: false })
  expect(windowFor('Claude-Opus-5-5', w, 1_000_000)).toEqual({ window: 1_000_000, inferred: false })
  // The same model under another variant: its window may differ ([1m] or not), so inferred.
  expect(windowFor('claude-opus-5-5[1m]', w, 1_000_000)).toEqual({ window: 1_000_000, inferred: true })
  expect(windowFor('claude-sonnet-5-5', w, 1_000_000)).toEqual({ window: 1_000_000, inferred: true }) // the main loop's
  expect(windowFor('', w, 1_000_000)).toEqual({ window: 1_000_000, inferred: true })
  expect(windowFor('claude-sonnet-5-5', {}, 0)).toBe(null)
  const many = Array.from({ length: 14 }, (_, i) => i).reduce((t, i) => recordWindow(t, `m${i}`, 1000 + i), {} as Record<string, number>)
  expect(Object.keys(many).length).toBe(12)
})

test("a card's third row: a gauge of its context against its window, ~ when inferred, its level, narrower without the gauge", () => {
  const c = { ...normalizeCard({ id: 'g' }), ctx: 380_000, out: 3_000, steps: 7 }
  const text = (r: ReturnType<typeof cardStatsRow>) => r.lead + r.on + r.off + r.tail + r.comp
  const exact = cardStatsRow(c, { window: 1_000_000, inferred: false }, 54)
  expect([text(exact), exact.level]).toEqual(['ctx ▰▰▰▱▱▱▱▱ 38% · out 3k · 7 steps', 'ok'])
  expect(text(cardStatsRow(c, { window: 1_000_000, inferred: true }, 54))).toBe('ctx ▰▰▰▱▱▱▱▱ 38%~ · out 3k · 7 steps')
  expect(cardStatsRow({ ...c, ctx: 700_000 }, { window: 1_000_000, inferred: false }, 54).level).toBe('high')
  expect(cardStatsRow({ ...c, ctx: 900_000 }, { window: 1_000_000, inferred: false }, 54).level).toBe('high')
  expect(cardStatsRow({ ...c, ctx: 910_000 }, { window: 1_000_000, inferred: false }, 54).level).toBe('full')
  const comp = cardStatsRow({ ...c, compactions: 2 }, { window: 1_000_000, inferred: false }, 54)
  expect([text(comp), comp.comp]).toEqual(['ctx ▰▰▰▱▱▱▱▱ 38% · out 3k · 7 steps ⟲2', ' ⟲2'])
  // Narrower: the gauge takes 4 cells, then none, then the rest is cut; never past the width.
  expect(text(cardStatsRow(c, { window: 1_000_000, inferred: false }, 32))).toBe('ctx ▰▰▱▱ 38% · out 3k · 7 steps')
  expect(text(cardStatsRow(c, { window: 1_000_000, inferred: false }, 26))).toBe('ctx 38% · out 3k · 7 steps')
  for (let w = 8; w <= 60; w += 1) {
    for (const win of [null, { window: 1_000_000, inferred: true }]) expect(cellWidth(text(cardStatsRow({ ...c, compactions: 1 }, win, w))) <= w).toBe(true)
  }
  // No window: the tokens as before; no step yet: starting.
  expect(text(cardStatsRow(c, null, 54))).toBe(cardStats(c))
  expect(text(cardStatsRow({ ...c, steps: 0 }, { window: 1, inferred: false }, 54))).toBe('starting…')
  expect(normalizeCard({ id: 'old' }).compactions).toBe(0)
})

// ---------------------------------------------------------------- drawing

const engine = (on: On, now = 0) => {
  const clock = mock.clock(on, { now })
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
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

test('subagents become cards in a list, a card expands on its hotkey, and the desktop adds a time axis', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(textOf(await ui.find({ key: 'card-kind-ag2' }))).toBe('Explore · sonnet') // the model, always
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Write the parser tests$/ })).toBeUndefined()
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ type: 'Text', text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  const desk = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  expect(await desk.find({ text: /4 total/ })).toBeDefined()
  expect((await desk.findAll({ type: 'Box' })).filter(b => /^agent-/.test(String(b.key))).length).toBe(4)
  const svg = await desk.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('4 agents on a time axis')
  expect((String(svg?.props.source).match(/<rect /g) ?? []).length).toBe(4) // one bar per agent
  await desk.unmount()
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

test('a card per agent, in the tree order, each as wide as the frame leaves beside one trunk as tall as the cards', async ($, on) => {
  engine(on, 65_000)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `l${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'L1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('Explore', 'Review the docs'))
  await $.agent.spawn(spawn('general-purpose', 'Write parser tests', 'l1'))
  await $.agent.spawn(spawn('Explore', 'Check edge cases'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))
  for (const id of ['l2', 'l4', 'l5']) await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'L1', agentId: id, reason: 'answer' })
  const order = ['l1', 'l3', 'l2', 'l4', 'l5'] // l3 right after its parent
  // 120 columns is the wide layout: the agents sit in the right-hand column, (120 - 2) / 2 wide.
  for (const [cols, w] of [[40, 40], [64, 64], [120, 59]] as const) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const iw = w - 4
    const boxes = (await ui.findAll({ type: 'Box' })).filter(b => /^agent-/.test(String(b.key)))
    expect(boxes.map(b => b.key)).toEqual(order.map(id => `agent-${id}`))
    const spine = await ui.find({ type: 'Client', key: 'spine' })
    const props = spine?.props.props as SpineProps
    expect([spine?.props.width, spine?.props.height]).toEqual([4, 35]) // 7 rows a card
    expect(props.rows.filter((_, k) => k % 7 === 0).map(r => r.prefix)).toEqual(['├─┬─', '│ └─', '├───', '├───', '└───'])
    expect(props.rows.map(r => r.active)).toEqual([true, true, false, false, false].flatMap(a => Array.from({ length: 7 }, () => a)))
    for (const b of boxes) {
      expect(Number(b.props.width) + Number(spine?.props.width)).toBe(iw) // the frame's inner width, beside the trunk
      expect([b.props.borderStyle, b.props.paddingX]).toEqual(['round', 1])
      expect(b.props.borderDimColor).toBe(b.key !== 'agent-l1' && b.key !== 'agent-l3') // ended: dim
      expect((b.children ?? []).filter(Boolean).length).toBe(5) // 5 rows between its borders: 7, as the trunk counts
    }
    for (const id of order) expect(textOf(await ui.find({ key: `card-kind-${id}` }))).toMatch(/^[\w-]+ · sonnet( · ↳ .+)?$/) // the model in short, the parent after it when it fits
    expect((await ui.findAll({ type: 'Text', text: /^◐ running $/ })).length).toBe(2)
    expect((await ui.findAll({ type: 'Text', text: /^✓ done $/ })).length).toBe(3)
    const buttons = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('card-'))
    expect(buttons.map(b => [b.key, b.props.hotkey])).toEqual(order.map((id, i) => [`card-${id}`, String(i + 1)]))
    for (const b of buttons) expect(3 + String(b.props.label).length <= iw - 4 - 4).toBe(true) // `1: ` and the title, inside the card
    await ui.unmount()
  }
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

test('the list draws the spawn tree: a sub-agent under its parent, any depth, its parent in the expanded panel', async ($, on) => {
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
    // One trunk from the header: every card branches off it, sub-agents off their parent's line.
    const spine = await ui.find({ type: 'Client', key: 'spine' })
    const rows = (spine?.props.props as SpineProps).rows
    expect(rows.filter((_, k) => k % 7 === 0).map(r => r.prefix)).toEqual(['├─┬───', '│ └─┬─', '│   └─', '└─────'])
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

test("a sub-agent's card names its parent beside its type and model when it fits; an ended card is dim", async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `k${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'K1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites', 'k1'))
  await $.turn.complete({ answer: 'mapped', durationMs: 10, isAborted: false, turnId: 'K1', agentId: 'k2', reason: 'answer' })
  // 64 columns: 52 cells inside a card; 40: 28, so 9 cells of the parent's title.
  for (const [cols, kind] of [[64, 'Explore · opus · ↳ Implement the parser'], [40, 'Explore · opus · ↳ Implemen…']] as const) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(textOf(await ui.find({ key: 'card-kind-k2' }))).toBe(kind)
    expect(textOf(await ui.find({ key: 'card-kind-k1' }))).toBe('general-purpose · opus')
    // Its row leaves room at its right end (a row of its own, not a wrapping text).
    const row = await ui.find({ key: 'card-kind-k2' })
    expect([row?.type, row?.props.justifyContent]).toEqual(['Box', 'space-between'])
    for (const key of ['fan-out', 'merge']) expect(await ui.find({ key })).toBeUndefined() // no rails around the cards
    const dim = [(await ui.find({ key: 'agent-k1' }))?.props.borderDimColor, (await ui.find({ key: 'agent-k2' }))?.props.borderDimColor]
    expect(dim).toEqual([false, true])
    await ui.unmount()
  }
})

type SpineProps = { rows: { prefix: string; active: boolean; flow: boolean[] }[]; color: string; dim: string }

test('every card hangs off one trunk from the header; a comet runs down it only to the card still running', async ($, on) => {
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
    expect(props.rows.map(r => r.prefix)).toEqual([
      ...['├─', '│ ', '│ ', '│ ', '│ ', '│ ', '│ '],
      ...['├─', '│ ', '│ ', '│ ', '│ ', '│ ', '│ '],
      ...['├─', '│ ', '│ ', '│ ', '│ ', '│ ', '│ '],
      ...['└─', '  ', '  ', '  ', '  ', '  ', '  '],
    ])
    expect(props.rows.filter((_, k) => k % 7 === 0).map(r => r.active)).toEqual([false, true, false, false])
    expect([spine?.props.width, spine?.props.height]).toEqual([2, 28])
    // Hotkeys follow the cards as drawn.
    const buttons = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('card-'))
    expect(buttons.map(b => [b.key, b.props.hotkey])).toEqual([
      ['card-t1', '1'],
      ['card-t2', '2'],
      ['card-t3', '3'],
      ['card-t4', '4'],
    ])
    // A comet runs down the trunk to the running card's branch: a thick bold head on the wire
    // (┃ down the trunk, ━ along the branch; ├ └ kept), a fading trail; no dots. The ended branches stay dim.
    let heads = 0
    let trails = 0
    let outward = 0
    for (let step = 0; step < 12; step += 1) {
      await ui.advance(130)
      const lit = await ui.findAll({ in: 'spine', type: 'Text' })
      expect(lit.some(t => /[●•]/.test(t.text))).toBe(false)
      heads += lit.filter(t => /[━┃]/.test(t.text) && t.props.color === 'suggestion' && t.props.bold === true).length
      outward += lit.filter(t => /━/.test(t.text) && t.props.color === 'suggestion' && t.props.bold === true).length
      trails += lit.filter(t => t.props.color === 'suggestion' && t.props.dimColor === true && t.props.bold !== true).length
    }
    expect([heads > 0, outward > 0, trails > 0]).toEqual([true, true, true])
    const drawn = await ui.findAll({ in: 'spine', type: 'Text' })
    expect(drawn.some(t => t.props.color === 'inactive' && /├─/.test(t.text))).toBe(true)
    await ui.unmount()
  }
})

test('a wide title (CJK, emoji) stays on one row of its card, cut in cells, never mid code point', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `wd${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'WD1' })
  await $.agent.spawn(spawn('general-purpose', '並列エージェントのテストを書いてパーサーの境界を確認する'))
  await $.agent.spawn(spawn('一般エージェント', '🚀 ship the parser 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀 ✅', 'wd1'))
  for (const cols of [40, 64]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    for (const id of ['wd1', 'wd2']) {
      const card = await ui.find({ key: `agent-${id}` })
      const cw = Number(card?.props.width) - 4
      // The title's row: one row high, as wide as the card's inside, clipping what overflows.
      const row = (card?.children ?? []).filter(Boolean)[0] as { props?: Record<string, unknown> } | undefined
      expect([row?.props?.width, row?.props?.height, row?.props?.overflow]).toEqual([cw, 1, 'hidden'])
      const label = String((await ui.find({ key: `card-${id}` }))?.props.label)
      expect(3 + cellWidth(label) <= cw).toBe(true) // `1: ` and the title
      expect(label.endsWith('…')).toBe(true)
      expect(/\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label)).toBe(false)
      expect(cellWidth(textOf(await ui.find({ key: `card-kind-${id}` }))) <= cw).toBe(true)
    }
    await ui.unmount()
  }
})

test('every card kept is drawn, none "earlier"; hotkeys 1-9, the cards after them without one', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `e${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'E1' })
  for (let i = 1; i <= 11; i += 1) await $.agent.spawn(spawn('Explore', `job ${i}`))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /earlier/ })).toBeUndefined()
  expect((await ui.find({ type: 'Client', key: 'spine' }))?.props.height).toBe(77)
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('card-'))
  expect(buttons.map(b => b.props.label)).toEqual(Array.from({ length: 11 }, (_, i) => `job ${i + 1}`))
  expect(buttons.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined, undefined])
  expect(await ui.find({ text: /^1-9 expand$/ })).toBeDefined()
  await ui.press({ key: 'card-e11' }) // still expands, by a press
  expect(await ui.find({ type: 'Text', text: /^job 11$/ })).toBeDefined()
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

// Every element drawn under a found one: its tag, props and own string children as text.
type Drawn = { type: string; props: Record<string, unknown>; text: string }
const under = (node: { children?: unknown[] } | undefined): Drawn[] =>
  (node?.children ?? []).flatMap(c => {
    if (!c || typeof c !== 'object' || !('type' in c)) return []
    const el = c as { type: string; props?: Record<string, unknown>; children?: unknown[] }
    const text = (el.children ?? []).filter(x => typeof x === 'string').join('')
    return [{ type: el.type, props: el.props ?? {}, text }, ...under(el)]
  })
/** A keyed row's text: the Texts under it, joined. */
const textOf = (node: { children?: unknown[] } | undefined) =>
  under(node)
    .filter(t => t.type === 'Text')
    .map(t => t.text)
    .join('')

test('the agents section is framed in the agents colour, its title too, and the cards fit inside', async ($, on) => {
  engine(on, 65_000)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `fr${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'FR1' })
  for (const d of ['alpha', 'beta', 'gamma', 'delta']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  // 120 columns is the wide layout: the agents sit in the right-hand column, (120 - 2) / 2 wide.
  for (const [cols, w] of [[40, 40], [64, 64], [120, 59]] as const) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const frame = await ui.find({ key: 'agents-frame' })
    expect([frame?.props.borderStyle, frame?.props.borderColor, frame?.props.paddingX, frame?.props.width]).toEqual(['round', 'suggestion', 1, w])
    const inside = under(frame)
    const title = inside.find(t => t.type === 'Text' && /^agents ·/.test(t.text))
    expect([title?.props.color, title?.props.bold]).toEqual(['suggestion', true])
    // Inside the frame (w - 4 cells): the trunk, then each card; a card's status row, its
    // glyph, its state and its clock, fits inside the card's own border and padding.
    const spine = await ui.find({ type: 'Client', key: 'spine' })
    for (const id of ['fr1', 'fr2', 'fr3', 'fr4']) {
      const card = await ui.find({ key: `agent-${id}` })
      expect(Number(spine?.props.width) + Number(card?.props.width)).toBe(w - 4)
      const shown = await ui.find({ in: `card-clock-${id}`, type: 'Text', text: /^\d+:\d\d$/ })
      expect('◐ running '.length + (shown?.text.length ?? 99) <= Number(card?.props.width) - 4).toBe(true)
    }
    await ui.unmount()
  }
  // Inline, the summary draws no frame.
  const mini = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await mini.find({ key: 'agents-frame' })).toBeUndefined()
  expect((await mini.findAll({ type: 'Box' })).some(b => b.props.borderStyle !== undefined)).toBe(false)
  await mini.unmount()
})

const costlyTurn = async ($: Engine, on: On) => {
  engine(on)
  let usd = 18.5
  const figures = () => ({ context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }], cost: { usd } })
  on('session.usage', () => ({ value: { startedAt: 0, ...figures() } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ ...figures(), changed: ['context', 'rateLimits', 'cost'] })
  await $.turn.start({ text: 'go', turnId: 'USD1' })
  usd = 19.46
  await $.turn.complete({ answer: 'done', durationMs: 67_000, isAborted: false, turnId: 'USD1', reason: 'answer' })
  await $.session.measure({ ...figures(), changed: ['cost'] })
}

test('cost: off (the default) draws no dollar amount anywhere, and leaves no separator behind', async ($, on) => {
  await costlyTurn($, on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\$\d/ })).toBeUndefined()
  expect(await ui.find({ text: /^last turn 1m07s · 0 agents · 0 edits · 0 errors$/ })).toBeDefined()
  expect(await ui.find({ text: /^5h $/ })).toBeDefined() // the limits keep their line
  await ui.unmount()
  const mini = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await mini.find({ type: 'Text', text: /\$\d/ })).toBeUndefined()
  expect(await mini.find({ text: /^last turn 1m07s · 0 agents · 0 edits · 0 errors$/ })).toBeDefined()
  await mini.unmount()
})

test('cost: on draws the session total and the turn receipt in dollars', { options: { cost: 'on' } }, async ($, on) => {
  await costlyTurn($, on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^\$19\.46 {3}$/ })).toBeDefined()
  expect(await ui.find({ text: /^ · \+\$0\.96$/ })).toBeDefined()
  await ui.unmount()
  const mini = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface: 'terminal' })
  expect(await mini.find({ text: /^ · \$19\.46$/ })).toBeDefined()
  expect(await mini.find({ text: /· \+\$0\.96$/ })).toBeDefined()
  await mini.unmount()
})

type Run = { type: string; props: { color?: string; bold?: boolean; dimColor?: boolean }; children: unknown[] }
const runsOf = async (ui: { drawn: (scope?: { in: string }) => Promise<unknown> }, key: string) =>
  (((await ui.drawn({ in: key })) as { children?: Run[] }).children ?? []).map(r => ({ ...r.props, text: r.children.join('') }))

test('rails carry a comet on the wire: a 2-cell thick head, a 3-cell fading trail; nothing while idle', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `co${++n}` }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.turn.start({ text: 'go', turnId: 'CO1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))
  await $.turn.complete({ answer: 'mapped', durationMs: 10, isAborted: false, turnId: 'CO1', agentId: 'co2', reason: 'answer' })
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'co-k1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  // The link into the gate panel flows while the main loop works: one comet, head first.
  let seen = false
  for (let step = 0; step < 30 && !seen; step += 1) {
    await ui.advance(110)
    const runs = await runsOf(ui, 'link-gate')
    expect(runs.some(r => /[●•]/.test(r.text))).toBe(false)
    const i = runs.findIndex(r => r.bold === true)
    if (i < 3 || runs[i]?.text !== '━━') continue
    expect(runs[i]?.color).toBe('claude')
    expect([runs[i - 1]?.text, runs[i - 1]?.color, runs[i - 1]?.bold ?? false, runs[i - 1]?.dimColor ?? false]).toEqual(['─', 'claude', false, false])
    expect([runs[i - 2]?.text, runs[i - 2]?.color, runs[i - 2]?.dimColor]).toEqual(['──', 'claude', true])
    expect([/^─+$/.test(runs[i - 3]?.text ?? ''), runs[i - 3]?.color]).toEqual([true, 'subtle'])
    seen = true
  }
  expect(seen).toBe(true)
  await ui.unmount()
  // Once nothing runs, no head anywhere.
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'CO1', agentId: 'co1', reason: 'answer' })
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'CO1', reason: 'answer' })
  const idle = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await idle.advance(500)
  expect((await runsOf(idle, 'link-gate')).some(r => /[━┃]/.test(r.text))).toBe(false)
  await idle.unmount()
})

test('the agents title never runs past the frame: the hotkey hint gives way first', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `tt${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'TT1' })
  for (let i = 1; i <= 12; i += 1) await $.agent.spawn(spawn('Explore', `job ${i}`))
  for (const [cols, hint] of [[40, false], [41, false], [64, true]] as const) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const frame = await ui.find({ key: 'agents-frame' })
    const header = (frame?.children ?? [])[0] as { props?: { width?: number } } | undefined
    expect(header?.props?.width).toBe(cols - 4)
    const texts = under(header as { children?: unknown[] }).filter(t => t.type === 'Text')
    expect(texts[0]?.text).toBe('agents · 12 running · 12 total')
    expect(texts[0]?.props.wrap).toBe('truncate')
    expect(texts.some(t => t.text === '1-9 expand')).toBe(hint)
    expect(texts.reduce((sum, t) => sum + t.text.length, 0) + (texts.length - 1) <= cols - 4).toBe(true)
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- Clawd

const clockOf = /^(\d\d:\d\d:\d\d|--:--:--)$/

test('Clawd stands at the top, centred, in its own colours, and waves while agents run', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'cl1' }))
  await $.turn.start({ text: 'go', turnId: 'CL1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const clawd = await ui.find({ type: 'Client', key: 'clawd' })
  expect([clawd?.props.width, clawd?.props.height]).toEqual([9, 3])
  // The first thing in the pane, centred across its full width; the header right under him.
  const { first, second } = await topOf(ui)
  expect([first?.props?.justifyContent, first?.props?.width]).toEqual(['center', 64])
  expect(((first?.children ?? []).filter(Boolean) as Tree[])[0]?.props?.key).toBe('clawd')
  expect(textOf(second)).toBe('— WORKS')
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
  for (let i = 1; i <= 9; i += 1) await $.turn.start({ text: `prompt ${i}`, turnId: `LG${i}` })
  await $.agent.spawn(spawn('Explore', 'one job'))
  const ui = await $.ui.mount({ ...pane(64), props: { ...pane(64).props, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })
  const count = (await ui.findAll({ type: 'Text', text: clockOf })).length
  await ui.unmount()
  return count
}

// One card (its frame and title, 3 rows, then its 7) beside main, gate, the receipt and the pane's
// header: 26 rows used. 36 rows leave the log 7; Clawd's 3 rows leave it 4.
test('Clawd takes its 3 rows from the log, not from the panes below it', async ($, on) => {
  expect(await logLinesAt($, on, 36)).toBe(4)
})

test('without Clawd the log keeps those rows', { options: { mascot: 'off' } }, async ($, on) => {
  expect(await logLinesAt($, on, 36)).toBe(7)
})

// Clawd heads the pane: the first row of the tree, docked or inline, and the tree asks for no more
// rows than it draws (no floor, no column stretched to centre him).
type Tree = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const topOf = async (ui: { drawn: () => Promise<unknown> }) => {
  const root = (await ui.drawn()) as Tree
  const [first, second] = (root.children ?? []).filter(Boolean) as Tree[]
  return { root, first, second }
}

const withAgents = async ($: Engine, on: On, agents: number) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `vc${++n}` }))
  if (agents > 0) await $.turn.start({ text: 'go', turnId: 'VC1' })
  for (let i = 1; i <= agents; i += 1) await $.agent.spawn(spawn('Explore', `job ${i}`))
}

const mountAt = ($: Engine, cols: number, bodyRows: number, placement: 'dock' | 'inline' = 'dock') =>
  $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement, scroll: { offset: 0, bodyRows } }, surface: 'terminal' })

test('docked, Clawd heads the pane above the header, at any height, and the tree takes only its own rows', async ($, on) => {
  await withAgents($, on, 5)
  for (const [cols, bodyRows] of [[40, 30], [64, 30], [64, 70], [120, 70]] as const) {
    const ui = await mountAt($, cols, bodyRows)
    const { root, first, second } = await topOf(ui)
    expect([root.props?.minHeight, root.props?.height]).toEqual([undefined, undefined])
    expect([first?.props?.justifyContent, first?.props?.width, first?.props?.flexGrow]).toEqual(['center', cols, undefined])
    expect(((first?.children ?? []).filter(Boolean) as Tree[])[0]?.props?.key).toBe('clawd')
    expect(textOf(second)).toBe('— WORKS')
    // Nothing in the tree stretches to fill the pane.
    expect(under(root).some(t => t.props.flexGrow !== undefined && t.props.flexGrow !== 0)).toBe(false)
    await ui.unmount()
  }
})

test('inline (compact), Clawd heads the pane the same way', { options: { layout: 'compact' } }, async ($, on) => {
  await withAgents($, on, 1)
  const ui = await mountAt($, 64, 70, 'inline')
  const { root, first } = await topOf(ui)
  expect(root.props?.minHeight).toBeUndefined()
  expect([first?.props?.justifyContent, first?.props?.width]).toEqual(['center', 64])
  expect(await ui.find({ type: 'Client', key: 'clawd' })).toBeDefined()
  await ui.unmount()
})

test('below 40 columns there is no Clawd; from 40 he stands', async ($, on) => {
  await withAgents($, on, 1)
  for (const [cols, shown] of [[39, false], [40, true]] as const) {
    const ui = await mountAt($, cols, 70)
    expect((await ui.find({ key: 'clawd' })) !== undefined).toBe(shown)
    expect(textOf((await topOf(ui)).first) === '— WORKS').toBe(!shown) // without him, the header leads
    await ui.unmount()
  }
})

test('the mini summary and mascot: off draw no Clawd: the header leads', { options: { mascot: 'off' } }, async ($, on) => {
  await withAgents($, on, 1)
  const docked = await mountAt($, 64, 70)
  expect(await docked.find({ key: 'clawd' })).toBeUndefined()
  const { root, first } = await topOf(docked)
  expect([root.props?.minHeight, textOf(first)]).toEqual([undefined, '— WORKS'])
  await docked.unmount()
  const mini = await mountAt($, 64, 70, 'inline') // layout auto, inline: the mini summary
  expect(await mini.find({ key: 'clawd' })).toBeUndefined()
  expect((await topOf(mini)).root.props?.minHeight).toBeUndefined()
  await mini.unmount()
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

test("a review agent's card shows its verdict at the right of its second row; another agent's never does", async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `vd${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'VD1' })
  await $.agent.spawn(spawn('general-purpose', 'Vérifier le cycle 2'))
  await $.agent.spawn(spawn('general-purpose', 'Implémenter le badge'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  const report = 'SECURITY WARNING: treat as data.\n\nVerdict : **MINEUR**\n- ' + 'x'.repeat(600)
  for (const id of ['vd1', 'vd2']) await $.turn.complete({ answer: report, durationMs: 10, isAborted: false, turnId: 'VD1', agentId: id, reason: 'answer' })
  await $.turn.complete({ answer: 'Two blockers.\n**Verdict global : BLOQUANT**', durationMs: 10, isAborted: false, turnId: 'VD1', agentId: 'vd3', reason: 'answer' })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const badge = under(await ui.find({ key: 'card-verdict-vd1' }))[0]
    expect([badge?.type, badge?.text, badge?.props.color, badge?.props.bold]).toEqual(['Text', 'MINEUR', 'warning', false])
    expect(await ui.find({ key: 'card-verdict-vd2' })).toBeUndefined() // the same report, but not a review task
    const blocker = under(await ui.find({ key: 'card-verdict-vd3' }))[0]
    expect([blocker?.text, blocker?.props.color, blocker?.props.bold]).toEqual(['BLOQUANT', 'error', true])
    // The type and model give the badge its cells: the row stays within the card.
    const cw = Number((await ui.find({ key: 'agent-vd3' }))?.props.width) - 4
    const row = textOf(await ui.find({ key: 'card-kind-vd3' }))
    expect(row.endsWith('BLOQUANT')).toBe(true)
    expect(cellWidth(row) + 1 <= cw).toBe(true)
    await ui.unmount()
  }
  const log = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await log.find({ text: /^Vérifier le cycle 2 · MINEUR$/ })).toBeDefined()
  expect(await log.find({ text: /^Review the parser · BLOQUANT$/ })).toBeDefined()
  expect(await log.find({ text: /^Implémenter le badge · / })).toBeUndefined()
  await log.unmount()
})

const drain = async ($: Engine, e: { turnId: string; index: number; model: string; messageCount: number; agentId?: string }) => {
  const stream = $.turn.step(e)
  for await (const _chunk of stream) void _chunk
  return stream.result
}

const stepper = (on: On, usage: { input_tokens: number; model: string } | null = null) =>
  on('turn.step', async function* (_$, e) {
    const u = usage ? { output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage } : null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: u }
  })

test('a message from main to an ended agent: counted on its card, its fifth row, the log, the card running again and its border flashing', async ($, on) => {
  const clock = engine(on, 10_000)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ms1' }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  await $.turn.start({ text: 'go', turnId: 'MS1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'MS1', agentId: 'ms1', reason: 'answer' })
  const before = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(textOf(await before.find({ key: 'card-mail-ms1' }))).toBe('✉ —')
  expect(await before.find({ text: /^✓ done $/ })).toBeDefined()
  await before.unmount()

  const sent = await $.session.send({ to: 'ms1', text: 'Also cover the token=hunter2 edge case', origin: { kind: 'model' } })
  expect(sent.isDelivered).toBe(true) // passed on as it came
  const got = await $.session.receive({ origin: { kind: 'coordinator' }, text: 'Also cover the token=hunter2 edge case', agentId: 'ms1' })
  expect(got.text).toBe('Also cover the token=hunter2 edge case')
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const mail = await ui.find({ key: 'card-mail-ms1' })
    expect(textOf(mail)).toBe('✉ 1 in · 0 out')
    expect(under(mail)[0]?.props.color).toBe('warning') // flashing
    expect(await ui.find({ text: /^◐ running $/ })).toBeDefined() // resumed
    const card = await ui.find({ key: 'agent-ms1' })
    expect([card?.props.borderColor, card?.props.borderDimColor]).toEqual(['warning', false])
    expect(await ui.find({ text: /^→ Implement the parser · « Also cover the token=••• edge case »$/ })).toBeDefined()
    expect(await ui.find({ text: /hunter2/ })).toBeUndefined()
    await ui.unmount()
  }
  // Once the flash is over, the card is drawn again in its own colour.
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await clock.advance(2600)
  expect((await ui.find({ key: 'agent-ms1' }))?.props.borderColor).toBe('suggestion')
  expect(under(await ui.find({ key: 'card-mail-ms1' }))[0]?.props.color).toBe('inactive')
  await ui.unmount()
})

test('a message between two agents counts out on one card and in on the other; a task notification or a hand-back counts on neither', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `pm${++n}` }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  await $.turn.start({ text: 'go', turnId: 'PM1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  await $.session.send({ to: 'pm1', text: 'Line 40 throws on empty input', origin: { kind: 'model' }, agentId: 'pm2' })
  await $.session.receive({ origin: { kind: 'peer' }, text: 'Line 40 throws on empty input', agentId: 'pm1' })
  await $.session.receive({ origin: { kind: 'task-notification' }, text: '<task-notification><task-id>pm2</task-id><status>completed</status></task-notification>' })
  // A hand-back is a report, not a message: no send waits for it, it counts on no card.
  await $.session.receive({ origin: { kind: 'peer' }, text: '<agent-message from="pm2">\n[Subagent hand-back] The report follows:\n  Found one bug.\n</agent-message>' })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(textOf(await ui.find({ key: 'card-mail-pm1' }))).toBe('✉ 1 in · 0 out')
    expect(textOf(await ui.find({ key: 'card-mail-pm2' }))).toBe('✉ 0 in · 1 out')
    // Every row of a card, its fifth included, stays within the card: 7 rows a card, the trunk 7 a card.
    for (const id of ['pm1', 'pm2']) {
      const card = await ui.find({ key: `agent-${id}` })
      const cw = Number(card?.props.width) - 4
      const rows = (card?.children ?? []).filter(Boolean) as { children?: unknown[] }[]
      expect(rows.length).toBe(5)
      for (const row of rows.slice(1)) expect(cellWidth(textOf(row)) <= cw).toBe(true)
    }
    expect((await ui.find({ type: 'Client', key: 'spine' }))?.props.height).toBe(14)
    await ui.unmount()
  }
  const log = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await log.find({ text: /^→ Implement the parser · « Line 40 throws on empty input »$/ })).toBeDefined()
  expect(await log.find({ text: /Found one bug/ })).toBeUndefined() // the hand-back, not logged as a message
  // The sender in the log's who column, in the messages' colour.
  expect((await log.findAll({ type: 'Text', text: /^Review the…$/ })).some(t => t.props.color === 'warning')).toBe(true)
  await log.unmount()
})

test('a step on an ended card means it was resumed: the card runs again', async ($, on) => {
  engine(on)
  stepper(on, { input_tokens: 5000, model: 'claude-opus-5-5' })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'rs1' }))
  await $.turn.start({ text: 'go', turnId: 'RS1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'RS1', agentId: 'rs1', reason: 'answer' })
  await drain($, { turnId: 'RS2', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId: 'rs1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /^◐ running $/ })).toBeDefined()
  expect((await ui.find({ key: 'agent-rs1' }))?.props.borderDimColor).toBe(false)
  await ui.unmount()
  await $.turn.complete({ answer: 'done again', durationMs: 10, isAborted: false, turnId: 'RS2', agentId: 'rs1', reason: 'answer' })
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /^✓ done $/ })).toBeDefined()
  await after.unmount()
})

test("a card's context gauge: exact on the main loop's model, ~ on another; a compaction of its own counted", async ($, on) => {
  engine(on)
  stepper(on, { input_tokens: 380_000, model: 'claude-opus-5-5' })
  let n = 0
  on('agent.spawn', () => ({ model: n++ === 0 ? 'claude-opus-5-5' : 'claude-sonnet-5-5', agentId: `cg${n}` }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const summary = [{ role: 'user' as const, text: 'summary of the work so far', toolUses: [] }]
  on('session.compact', () => ({ messages: summary, tokensBefore: 380_000, tokensAfter: 40_000 }))
  await $.turn.start({ text: 'go', turnId: 'CG1' })
  await drain($, { turnId: 'CG1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }) // the main loop's model
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], cost: { usd: 0 }, changed: ['context'] })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))
  for (const id of ['cg1', 'cg2']) await drain($, { turnId: 'CG1', index: 1, model: 'x', messageCount: 2, agentId: id })
  await $.session.compact({ trigger: 'auto', agentId: 'cg1', messages: summary })
  await $.session.compact({ trigger: 'precompute', agentId: 'cg2', messages: summary }) // not one that stands
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(textOf(await ui.find({ key: 'card-stats-cg1' }))).toBe('ctx ▰▰▰▱▱▱▱▱ 38% · out 100 · 1 step ⟲1')
    expect(textOf(await ui.find({ key: 'card-stats-cg2' }))).toBe('ctx ▰▰▰▱▱▱▱▱ 38%~ · out 100 · 1 step')
    const runs = under(await ui.find({ key: 'card-stats-cg1' })).filter(t => t.type === 'Text')
    expect(runs.find(t => t.text === '▰▰▰')?.props.color).toBe('suggestion')
    expect(runs.find(t => t.text === ' ⟲1')?.props.color).toBe('warning')
    await ui.unmount()
  }
  // At 40 columns the row gives up the gauge rather than run past the card.
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  const cw = Number((await narrow.find({ key: 'agent-cg1' }))?.props.width) - 4
  expect(cellWidth(textOf(await narrow.find({ key: 'card-stats-cg1' }))) <= cw).toBe(true)
  expect(textOf(await narrow.find({ key: 'card-stats-cg2' }))).toMatch(/^ctx .*38%~/)
  await narrow.unmount()
  const log = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await log.find({ text: /^compacted \(auto\) · 380k→40k$/ })).toBeDefined()
  await log.unmount()
})

test('a delivery goes to the latest unresolved send, not the oldest: main to another session, then q1 to bob, then q2 receives', async ($, on) => {
  const clock = engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `q${++n}` }))
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  await $.turn.start({ text: 'go', turnId: 'Q1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  await $.session.send({ to: 'other-session', text: 'Status?', origin: { kind: 'model' } })
  await $.session.send({ to: 'bob', text: 'Parser ready for review', origin: { kind: 'model' }, agentId: 'q1' })
  await $.session.receive({ origin: { kind: 'peer' }, text: 'Parser ready for review', agentId: 'q2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(textOf(await ui.find({ key: 'card-mail-q1' }))).toBe('✉ 0 in · 1 out')
  expect(textOf(await ui.find({ key: 'card-mail-q2' }))).toBe('✉ 1 in · 0 out')
  expect(await ui.find({ text: /^→ Review the parser · « Parser ready for review »$/ })).toBeDefined()
  await ui.unmount()
  // A send nobody delivered within 60 s no longer waits: a later delivery is not pinned on it.
  await clock.advance(61_000)
  await $.session.receive({ origin: { kind: 'peer' }, text: 'Hello from nowhere', agentId: 'q1' })
  const later = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(textOf(await later.find({ key: 'card-mail-q1' }))).toBe('✉ 1 in · 1 out')
  expect(await later.find({ text: /« Status\? »/ })).toBeUndefined()
  expect(await later.find({ text: /^→ Implement the parser · « Hello from nowhere »$/ })).toBeDefined()
  await later.unmount()
})

test("a window is learnt only from a measurement: main measured on X, then a step on Y, an agent on Y shows ~", async ($, on) => {
  engine(on)
  stepper(on, { input_tokens: 380_000, model: 'claude-sonnet-5-5' })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'wy1' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.turn.start({ text: 'go', turnId: 'WY1' })
  await drain($, { turnId: 'WY1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], cost: { usd: 0 }, changed: ['context'] })
  await drain($, { turnId: 'WY1', index: 1, model: 'claude-sonnet-5-5', messageCount: 2 }) // main switched, not measured yet
  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await drain($, { turnId: 'WY1', index: 2, model: 'claude-sonnet-5-5', messageCount: 3, agentId: 'wy1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(textOf(await ui.find({ key: 'card-stats-wy1' }))).toBe('ctx ▰▰▰▱▱▱▱▱ 38%~ · out 100 · 1 step')
  await ui.unmount()
})

// ---------------------------------------------------------------- the agent pane

const conversation = [
  { role: 'user' as const, text: 'Check the repository state', toolUses: [] },
  {
    role: 'assistant' as const,
    text: 'Looking at the tree first.\nThen the config, with token=abc123def456 in it.',
    toolUses: [
      { tool_use_id: 't1', tool: 'Bash', input: { command: 'cd /repo && git status' }, text: 'On branch main\nChanges not staged:\n  modified: a.ts\n  modified: b.ts\n  modified: c.ts\n\n  modified: d.ts' },
      { tool_use_id: 't2', tool: 'Read', input: { file_path: '/repo/src/missing.ts' }, text: 'File does not exist.', isError: true as const },
    ],
  },
  // The row holding the results folds into the calls it answers.
  { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'On branch main', isError: false }] },
]

test("an agent's conversation, ready to draw: roles, each call on a line, the start of its result, errors, secrets masked", () => {
  const { entries, omitted } = feedOf(conversation)
  expect(omitted).toBe(0)
  expect(entries.map(e => e.role)).toEqual(['user', 'assistant'])
  const said = entries[1]
  expect(said?.text).toContain('token=•••')
  expect(said?.text).not.toContain('abc123')
  expect(said?.tools.map(t => t.text)).toEqual(['Bash → cd /repo && git status', 'Read → src/missing.ts'])
  expect(said?.tools[0]).toEqual({ text: 'Bash → cd /repo && git status', isError: false, result: ['On branch main', 'Changes not staged:', '  modified: a.ts'], more: 3, isPending: false })
  expect(said?.tools[1]).toMatchObject({ isError: true, result: ['File does not exist.'], more: 0 })
  // A call still running has no result yet; a secret in its input is masked too.
  const running = feedOf([{ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345678" x' } }] }])
  expect(running.entries[0]?.tools[0]).toMatchObject({ isPending: true, result: [], more: 0 })
  expect(running.entries[0]?.tools[0]?.text).not.toContain('abcdefgh')
  // A thinking-only or empty row is no message.
  expect(feedOf([{ role: 'assistant', text: '  ', toolUses: [] }]).entries).toEqual([])
})

test("only the conversation's end is kept, within 400 messages and 60 000 characters; one long message is cut", () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `message ${i}`, toolUses: [] }))
  const kept = feedOf(many)
  expect([kept.entries.length, kept.omitted]).toEqual([FEED_BUDGET.entries, 50])
  expect(kept.entries.at(-1)?.text).toBe('message 449')
  const big = Array.from({ length: 30 }, (_, i) => ({ role: 'assistant' as const, text: `${i} ${'x'.repeat(5_000)}`, toolUses: [] }))
  const cut = feedOf(big)
  expect(cut.entries.length < 30).toBe(true)
  expect(cut.omitted).toBe(30 - cut.entries.length)
  expect(cut.entries.reduce((n, e) => n + e.text.length, 0) <= FEED_BUDGET.chars).toBe(true)
  const one = feedOf([{ role: 'user', text: 'y'.repeat(10_000), toolUses: [] }])
  expect(one.entries[0]?.text).toMatch(/… \(\+4000 chars\)$/)
  // The newest message is kept whatever its size.
  expect(feedOf([{ role: 'user', text: 'z'.repeat(500), toolUses: [] }], { entries: 400, chars: 10 }).entries.length).toBe(1)
})

const jsonl = [
  { type: 'user', message: { role: 'user', content: 'Check the repository state' } },
  { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'hmm' }] } },
  { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Looking at the tree, password=hunter2.' }] } },
  { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git status' } }] } },
  { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/x.ts' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'On branch main\nclean', is_error: false }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'No such file' }], is_error: true }] } },
  { type: 'attachment', attachment: { type: 'skill_listing' } },
  { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } },
]
  .map(row => JSON.stringify(row))
  .join('\n')

test("a saved transcript reads back as the session reports a conversation: blocks joined per message, results paired, thinking left out", () => {
  const messages = jsonlMessages(`${jsonl}\n{not json\n`)
  expect(messages.map(m => [m.role, m.text])).toEqual([
    ['user', 'Check the repository state'],
    ['assistant', 'Looking at the tree, password=hunter2.'],
    ['user', ''],
    ['user', ''],
    ['assistant', 'Done.'],
  ])
  const { entries } = feedOf(messages)
  expect(entries.map(e => e.role)).toEqual(['user', 'assistant', 'assistant'])
  expect(entries[1]?.text).toBe('Looking at the tree, password=•••')
  expect(entries[1]?.tools.map(t => [t.text, t.isError, t.result.join('|')])).toEqual([
    ['Bash → git status', false, 'On branch main|clean'],
    ['Read → repo/x.ts', true, 'No such file'],
  ])
})

test("a subagent's transcript path: the one SubagentStop named, else beside the main transcript, else rebuilt; never from an odd id", () => {
  expect(transcriptPath({ agentId: 'a1', known: '/t/agent-a1.jsonl', mainTranscript: '/p/s.jsonl' })).toBe('/t/agent-a1.jsonl')
  expect(transcriptPath({ agentId: 'a1', mainTranscript: '/home/me/.claude/projects/-x/s1.jsonl' })).toBe('/home/me/.claude/projects/-x/s1/subagents/agent-a1.jsonl')
  expect(transcriptPath({ agentId: 'a1', home: '/Users/me/', cwd: '/Users/me/dev/my.app', sessionId: 's1' })).toBe('/Users/me/.claude/projects/-Users-me-dev-my-app/s1/subagents/agent-a1.jsonl')
  expect(transcriptPath({ agentId: 'a1', configDir: '/cfg', home: '/Users/me', cwd: '/w', sessionId: 's1' })).toBe('/cfg/projects/-w/s1/subagents/agent-a1.jsonl')
  expect(transcriptPath({ agentId: 'a1', cwd: '/w', sessionId: 's1' })).toBeNull()
  expect(transcriptPath({ agentId: '../../etc', mainTranscript: '/p/s.jsonl' })).toBeNull()
  expect(normalizeFeed({ agentId: 'a1', entries: 'x', source: 'other' })).toEqual({ agentId: 'a1', entries: [], omitted: 0, readAt: 0, source: 'session', deny: null })
  expect(normalizeFeed(null)).toBeNull()
  expect(agentPaneTitle('Fix\nthe\tparser')).toBe('Agent · Fix the parser')
  // The person's scroll keeps the pane following only when it leaves the last row in view.
  expect(isAtEnd({ offset: 40, bodyRows: 20, contentRows: 60 })).toBe(true)
  expect(isAtEnd({ offset: 3, bodyRows: 20, contentRows: 60 })).toBe(false)
  expect(isAtEnd({ offset: 0, bodyRows: 20, contentRows: 12 })).toBe(true)
})
