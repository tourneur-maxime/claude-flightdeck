// The lanes' trunk column, drawn on the surface's frame clock: packets run down from the header
// and out along each running agent's branch, and the column rests dim when nothing runs. One
// region for the whole column; only it redraws, the pane does not.
import type { ClientModule } from 'claude-code'

/** One row: its branch glyphs (one width for all), whether its agent runs, and the cells on the way to one that does. */
type Row = { prefix: string; active: boolean; flow: boolean[] }

type Props = { rows: Row[]; color: string; dim: string }

type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 130
/** A packet every 6 cells along the way: a bright head and a trailing dot. */
const PERIOD = 6

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

  // A cell's distance from the header is its row plus its column: a packet steps down the trunk,
  // then along a branch, one cell per frame.
  return (
    <Box flexDirection="column">
      {props.rows.map((r, y) => {
        const runs: { text: string; kind: 'dim' | 'way' | 'lit' }[] = []
        Array.from(r.prefix).forEach((ch, x) => {
          const onWay = r.flow[x] === true
          const k = (((x + y - ref.phase) % PERIOD) + PERIOD) % PERIOD
          const glyph = onWay && k === 0 ? '●' : onWay && k === PERIOD - 1 ? '•' : ch
          const kind = !onWay ? 'dim' : glyph !== ch ? 'lit' : 'way'
          const last = runs[runs.length - 1]
          if (last && last.kind === kind) last.text += glyph
          else runs.push({ text: glyph, kind })
        })
        return (
          <Box>
            {runs.map(run => (
              <Text color={run.kind === 'dim' ? props.dim : props.color} bold={run.kind === 'lit'}>
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
