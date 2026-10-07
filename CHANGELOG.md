# Changelog

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
