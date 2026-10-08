// A connector drawn on the surface's own frame clock: packets travel along it while `active`,
// and it rests as a plain dim line otherwise. Only this region redraws; the pane does not.
import type { ClientModule } from 'claude-code'

type Props = {
  active: boolean
  width: number
  color: string
  dim: string
}

type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 110

/** A comet, front first: 2 head cells, then a 3-cell trail (one bright, two faint). */
type Level = 'head' | 'trail' | 'fade' | 'rest'
const TAIL: Level[] = ['head', 'head', 'trail', 'fade', 'fade']

/** Cells between two comets' heads. */
const PERIOD = 24

/** How far cell `i` is behind the nearest head at `phase`: 0 on a head, up to PERIOD - 1. */
const railDistance = (phase: number, i: number) => (((phase - i) % PERIOD) + PERIOD) % PERIOD

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
  const cells = Array.from({ length: width }, () => '─')

  if (!props.active) {
    return (
      <Box>
        <Text color={props.dim}>{cells.join('')}</Text>
      </Box>
    )
  }

  // A comet every PERIOD cells, moving left to right on the wire itself: a 2-cell head drawn
  // thick and bold, then a 3-cell trail in the line's own glyph, fading (bright, then faint) into
  // the dim rest of the line. A cell's level comes from its own distance behind the nearest head,
  // so the comets stay PERIOD apart at any width: none wraps round to close the gap.
  // Runs, not cells: consecutive cells of one level share a Text, a handful of nodes per frame.
  const runs: { text: string; lv: Level }[] = []
  cells.forEach((ch, i) => {
    const lv: Level = TAIL[railDistance(ref.phase, i)] ?? 'rest'
    const glyph = lv === 'head' ? '━' : ch
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
