// Clawd at the foot of the pane, on the surface's frame clock: he waves while agents run, blinks
// now and then while the main loop works, and stands still when nothing runs. The glyphs come in
// as props (CLAWD in core.ts); only this region redraws, the pane does not.
import type { ClientModule } from 'claude-code'

type Span = { text: string; on?: 'eyes' | 'lid' }
type Pose = 'default' | 'armsUp' | 'blink' | 'wink'
/** agents: at least one subagent runs. main: only the main loop works. rest: nothing runs. */
type Mode = 'agents' | 'main' | 'rest'

type Props = { mode: Mode; poses: Record<Pose, Span[][]>; body: string; eyes: string }

type Ref = { tick: number; mode: Mode; pose: Pose }
type State = { ref: Ref }

const STEP_MS = 150

/** The pose at a tick: arms up and down every 600 ms with a wink every eighth beat; a 300 ms blink about every 4 s. */
const poseAt = (mode: Mode, tick: number): Pose => {
  if (mode === 'agents') {
    const beat = Math.floor(tick / 4)
    return beat % 8 === 7 ? 'wink' : beat % 2 === 1 ? 'armsUp' : 'default'
  }
  if (mode === 'main') return tick % 27 >= 25 ? 'blink' : 'default'
  return 'default'
}

const Clawd: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { tick: 0, mode: props.mode, pose: 'default' }
  ref.mode = props.mode
  if (surface.state === undefined) {
    surface.setState({ ref })
    // One timer; it redraws only when the pose changes, so at rest it draws nothing new.
    surface.every(STEP_MS, () => {
      if (ref.mode === 'rest') return
      ref.tick += 1
      if (poseAt(ref.mode, ref.tick) !== ref.pose) surface.setState({ ref })
    })
  }
  ref.pose = poseAt(ref.mode, ref.tick)
  const rows = props.poses[ref.pose] ?? props.poses.default
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Box>
          {row.map(s =>
            s.on === 'lid' ? (
              <Text color={props.eyes} backgroundColor={props.body}>
                {s.text}
              </Text>
            ) : s.on === 'eyes' ? (
              <Text color={props.body} backgroundColor={props.eyes}>
                {s.text}
              </Text>
            ) : (
              <Text color={props.body}>{s.text}</Text>
            ),
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Clawd
