// The agent cards' trunk column, drawn on the surface's frame clock: a comet runs down from the
// header and out along each running agent's branch, and the column rests dim when nothing runs.
// Several rows beside each card (cardSpine in core.ts); one region for the whole column; only it
// redraws, the pane does not.
import type { ClientModule } from 'claude-code'

/** One row: its branch glyphs (one width for all), whether its agent runs, and the cells on the way to one that does. */
type Row = { prefix: string; active: boolean; flow: boolean[] }

type Props = { rows: Row[]; color: string; dim: string }

type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 130
/** A comet every 6 cells along the way, front first: 2 head cells, then a 3-cell trail (one bright, two faint). */
const PERIOD = 6
type Level = 'head' | 'trail' | 'fade' | 'rest'
const TAIL: Level[] = ['head', 'head', 'trail', 'fade', 'fade']
/** The head is drawn thick on the wire; the branch glyphs (├ └) keep their shape. */
const THICK: Record<string, string> = { '│': '┃', '─': '━' }

const Spine: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const isActive = props.rows.some(r => r.active)
  const ref = surface.state?.ref ?? { phase: 0, active: isActive }
  ref.active = isActive
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.phase += 1
        surface.setState({ ref })
      }
    })
  }

  if (!isActive) {
    return (
      <Box flexDirection="column">
        {props.rows.map(r => (
          <Text color={props.dim}>{r.prefix}</Text>
        ))}
      </Box>
    )
  }

  // A cell's distance from the header is its row plus its column: a comet steps down the trunk,
  // then along a branch, one cell per frame; off its head and trail the way rests dim.
  return (
    <Box flexDirection="column">
      {props.rows.map((r, y) => {
        const runs: { text: string; lv: Level }[] = []
        Array.from(r.prefix).forEach((ch, x) => {
          const d = (((ref.phase - x - y) % PERIOD) + PERIOD) % PERIOD
          const lv: Level = r.flow[x] === true ? TAIL[d] ?? 'rest' : 'rest'
          const glyph = lv === 'head' ? THICK[ch] ?? ch : ch
          const last = runs[runs.length - 1]
          if (last && last.lv === lv) last.text += glyph
          else runs.push({ text: glyph, lv })
        })
        return (
          <Box>
            {runs.map(run => (
              <Text color={run.lv === 'rest' ? props.dim : props.color} bold={run.lv === 'head'} dimColor={run.lv === 'fade'}>
                {run.text}
              </Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

export default Spine
