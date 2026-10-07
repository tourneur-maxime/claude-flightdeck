// A connector drawn on the surface's own frame clock: packets travel along it while `active`,
// and it rests as a plain dim line otherwise. Only this region redraws; the pane does not.
import type { ClientModule } from 'claude-code'

/** A branch to one child: where it drops, and whether that child is still running. */
type Mark = { at: number; active: boolean }

type Props = {
  active: boolean
  width: number
  color: string
  dim: string
  /** Cells where a branch drops (┬); the rest of the line is ─. */
  marks: Mark[]
  /** Draw ┴ instead of ┬ at the marks: a merge into what is below. */
  isMerge: boolean
}

type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 110

/** A comet, front first: 2 head cells, then a 3-cell trail (one bright, two faint). */
type Level = 'head' | 'trail' | 'fade' | 'rest'
const TAIL: Level[] = ['head', 'head', 'trail', 'fade', 'fade']

const Rail: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, active: props.active }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.phase += 1
        surface.setState({ ref })
      }
    })
  }

  const width = Math.max(1, surface.columns || props.width)
  const marks = props.marks.filter(m => m.at >= 0 && m.at < width)
  const cells = Array.from({ length: width }, () => '─')
  for (const m of marks) cells[m.at] = props.isMerge ? '┴' : '┬'

  if (!props.active) {
    return (
      <Box>
        <Text color={props.dim}>{cells.join('')}</Text>
      </Box>
    )
  }

  // Each cell belongs to the branch whose mark is nearest: packets flow only along a running
  // child's stretch, and a finished child's stretch stays still. With no marks, the whole line flows.
  const owner = (i: number) => {
    let best: Mark | null = null
    for (const m of marks) if (!best || Math.abs(m.at - i) < Math.abs(best.at - i)) best = m
    return best
  }
  const flows = cells.map((_, i) => owner(i)?.active ?? true)

  // A comet every 24 cells, moving left to right on the wire itself: a 2-cell head drawn thick
  // and bold, then a 3-cell trail in the line's own glyph, fading (bright, then faint) into the
  // dim rest of the line.
  const level = new Map<number, Level>()
  for (let base = 0; base < width + 24; base += 24) {
    const head = (base + ref.phase) % (width + 24)
    TAIL.forEach((lv, d) => {
      if (head - d >= 0 && head - d < width) level.set(head - d, lv)
    })
  }
  const markAt = new Map(marks.map(m => [m.at, m]))
  // Runs, not cells: consecutive cells of one level share a Text, a handful of nodes per frame.
  // A running child's mark is always bright and keeps its glyph under the comet; a finished
  // child's mark is dim and no comet covers it.
  const runs: { text: string; lv: Level }[] = []
  cells.forEach((ch, i) => {
    const mark = markAt.get(i)
    const lv: Level = mark ? (mark.active ? 'head' : 'rest') : flows[i] ? level.get(i) ?? 'rest' : 'rest'
    const glyph = !mark && lv === 'head' ? '━' : ch
    const last = runs[runs.length - 1]
    if (last && last.lv === lv) last.text += glyph
    else runs.push({ text: glyph, lv })
  })
  return (
    <Box>
      {runs.map(r => (
        <Text color={r.lv === 'rest' ? props.dim : props.color} bold={r.lv === 'head'} dimColor={r.lv === 'fade'}>
          {r.text}
        </Text>
      ))}
    </Box>
  )
}

export default Rail
