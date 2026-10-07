# Changelog

## 0.5.1

- The agents section sits in a round frame in the agents colour, like the other panels, and its title takes that colour too. Cards, rails and lanes are laid out inside it, 4 cells narrower: three cards now need a 66-column pane (62 before), and the lanes' time axis gives up those 4 cells while the 19 cells before it stay put. The expanded card stays below the frame, and the log gives up the frame's 2 rows.
- Clawd stands centred at the foot of the pane instead of on the right.
- New `cost` option (`on`/`off`, default `off`): off, the pane draws no dollar amount, neither the session's cost (main panel, inline summary) nor the turn's (receipt). The figures are still tracked.
- 45 tests.

## 0.5.0

- Swimlanes hang off one trunk that starts under the agents header: every agent gets a branch (`├─`, the last one `└─`), main's own agents included, so a session that spawns many agents from the main loop now shows the flow too. Packets run down the trunk and out along each running agent's branch; ended branches stay dim. One `Client` draws the whole column; without motion, or on VS Code and mobile, the same glyphs are drawn still in each agent's status colour. No row is added and the time axis stays aligned at 40, 64 and 120 columns.
- Clawd, Claude Code's own mascot, stands at the foot of the docked pane: he waves while agents run, blinks while the main loop works, and stands still otherwise. The new `mascot` option (`on`/`off`) leaves him out; the log gives up his 3 rows.
- Fix: on VS Code and mobile, rails and live clocks drew as empty boxes; they are drawn still there now.
- 41 tests.

## 0.4.0

- The agents panel draws the spawn tree: a sub-agent sits under the agent that spawned it, read from `agent.spawn`'s `parentAgentId`, at any depth. Lanes show the branch (`├─`, `└─`) before the title, with the time axis still aligned; a sub-agent's card says `↳ parent`; the expanded card names its parent.
- Each branch of the card rails has its own state: it flows while its agent runs and turns dim once it ends.
- The header starts with the model; the `FLIGHTDECK` label is gone (the pane's tab still names it).

## 0.3.2

- A background architect's advice is read from its `SubagentHandback` tool call, where the report actually arrives, with the hand-back text as a fallback. Bold markers no longer leak into the advice line.
- README: no longer promises that counters survive every update; a change to the state's shape may reset them once.

## 0.3.1

- The main box shows the model and effort as soon as a request starts, not after the first one finishes.
- Advice from a background architect agent (such as `fable-advisor`) now reaches the architect's `»` line; it arrives as a hand-back message, not as the agent's own answer.
- New README media showing the Flightdeck header; plainer wording about opening on start.
- More gate tests (24 in all).

## 0.3.0

First public release.

- Panels: main vitals (context, compactions, cost, rate limits), architect timeline, permission gate strip with per-family drill-down, agent cards and swimlanes, other loops, turn receipt, session log.
- Layouts: docked one- or two-column, and an 8-row inline summary for the main screen. Cards fall back to swimlanes when they don't fit.
- Theme colours by default, with a `pastel` palette option.
- Animated connectors and live clocks as surface modules, only while work flows.
- Works on the terminal, desktop app, VS Code and mobile surfaces.
- Config for the architect pattern, labels, panels, layout, card limit, motion, moments, palette, opening on start and the status line.
- `/clear` and `/flightdeck reset` start the pane fresh; reads tolerate missing or older fields.
