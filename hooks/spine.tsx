// The agent cards' trunk column, drawn on the surface's frame clock. It rests dim; an exchange
// between main and an agent runs along that agent's way for a moment: comets down the trunk and
// out along its branch for its brief or a message to it, back up in amber for its report or a
// message from it. One region for the whole column; only it redraws, the pane does not.
import type { ClientModule } from 'claude-code'

/** An exchange on one agent's way: its direction, when it stops, and the cells of that way (row, then column). */
type Pulse = { dir: 'in' | 'out'; until: number; flow: boolean[][] }

/** `rows`: each row's branch glyphs, one width for all. `now`: the hooks module's clock at this drawing. */
type Props = { rows: string[]; pulses: Pulse[]; now: number; color: string; inColor: string; dim: string }

type Ref = { phase: number; lastNow: number; ticks: number; pulses: Pulse[]; isLive: boolean }
type State = { ref: Ref }

const STEP_MS = 130
/** A comet every 6 cells along the way, front first: 2 head cells, then a 3-cell trail (one bright, two faint). */
const PERIOD = 6
type Level = 'head' | 'trail' | 'fade' | 'rest'
const TAIL: Level[] = ['head', 'head', 'trail', 'fade', 'fade']
/** The head is drawn thick on the wire; the branch glyphs (├ └) keep their shape. */
const THICK: Record<string, string> = { '│': '┃', '─': '━' }

/** The clock between drawings: the last reading plus this module's own steps. */
const localNow = (ref: Ref) => ref.lastNow + ref.ticks * STEP_MS
const livePulses = (ref: Ref) => ref.pulses.filter(p => p.until > localNow(ref))

const Spine: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, lastNow: props.now, ticks: 0, pulses: props.pulses, isLive: false }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: count the steps from it.
    ref.lastNow = props.now
    ref.ticks = 0
  }
  ref.pulses = props.pulses
  const live = livePulses(ref)
  ref.isLive = live.length > 0
  if (surface.state === undefined) {
    surface.setState({ ref })
    // One more frame after the last exchange stops, to draw the trunk at rest.
    surface.every(STEP_MS, () => {
      if (!ref.isLive) return
      ref.ticks += 1
      ref.phase += 1
      ref.isLive = livePulses(ref).length > 0
      surface.setState({ ref })
    })
  }

  if (live.length === 0) {
    return (
      <Box flexDirection="column">
        {props.rows.map(prefix => (
          <Text color={props.dim}>{prefix}</Text>
        ))}
      </Box>
    )
  }

  // A cell's distance from the header is its row plus its column: an outgoing comet steps down
  // the trunk, then along a branch, one cell per frame; an incoming one the other way. Where both
  // share a cell, the incoming one shows. Off a head and its trail, the way rests dim.
  const levelAt = (x: number, y: number): { lv: Level; dir: 'in' | 'out' } => {
    let out: Level = 'rest'
    for (const p of live) {
      if (p.flow[y]?.[x] !== true) continue
      const d = p.dir === 'in' ? (((ref.phase + x + y) % PERIOD) + PERIOD) % PERIOD : (((ref.phase - x - y) % PERIOD) + PERIOD) % PERIOD
      const lv = TAIL[d] ?? 'rest'
      if (lv === 'rest') continue
      if (p.dir === 'in') return { lv, dir: 'in' }
      out = lv
    }
    return { lv: out, dir: 'out' }
  }
  return (
    <Box flexDirection="column">
      {props.rows.map((prefix, y) => {
        const runs: { text: string; lv: Level; dir: 'in' | 'out' }[] = []
        Array.from(prefix).forEach((ch, x) => {
          const { lv, dir } = levelAt(x, y)
          const glyph = lv === 'head' ? THICK[ch] ?? ch : ch
          const last = runs[runs.length - 1]
          if (last && last.lv === lv && last.dir === dir) last.text += glyph
          else runs.push({ text: glyph, lv, dir })
        })
        return (
          <Box>
            {runs.map(run => (
              <Text color={run.lv === 'rest' ? props.dim : run.dir === 'in' ? props.inColor : props.color} bold={run.lv === 'head'} dimColor={run.lv === 'fade'}>
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
