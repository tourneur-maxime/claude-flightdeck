# Changelog

## 0.6.0

- The agents section is a list: one card per agent, one under the other, every card kept (the latest 24) at the frame's full inner width, each sub-agent right after its parent. Swimlanes and their time axis, `+N earlier`, the cards side by side and the fan-out and merge rails are gone; the pane scrolls when the list is long.
- A card has 4 rows: the task (hotkeys `1` to `9`, the cards after the ninth expand by a click); its type and model, the model always shown and in short (`opus`, `sonnet`, `haiku`, or the model's name), with `↳ parent` beside it for a sub-agent when it fits; context, output and steps; its state (`◐ running`, `✓ done`, `✗ failed`, `■ stopped`, `max_tokens` in red) with its clock. The expanded card is unchanged.
- The trunk runs down the left of the cards, 6 rows beside each: a branch on each card's top row, and a `┬` where a parent's children hang, their line running down beside the parent's card. The comet still runs down it and out along each running agent's branch.
- Clawd stands at the top of the pane, centred above the model line, instead of at its foot; the docked pane no longer stretches to its full height to centre him.
- The `maxCards` option is gone: with a list, there is nothing to cap side by side. A value left in settings is ignored.
- The desktop's SVG time axis draws a bar for every card, in the list's order.
- 52 tests.

## 0.5.3

- Clawd's centring no longer estimates the rows above him, an estimate that ran short (rate limits, connectors, cards, the wide layout) and made the pane overflow at some heights. Docked, the pane's tree now asks for at least the pane's rows, and Clawd stands in a column that takes whatever rows the panels and the log leave and centres him in them; with none left it is his own 3 rows, right under the log, and nothing is pushed or cut. Inline, the frame still fits the tree and he stays under the log. The log's own rows are unchanged.
- 51 tests.

## 0.5.2

- Docked, Clawd stands centred in the rows left between the log and the foot of the pane instead of right under the log. Inline, the frame fits the tree and he stays under the log. The log's own rows are unchanged. (As shipped, the rows above him were estimated and could come up 3 to 5 rows short, pushing the pane past its height; 0.5.3 replaces the estimate.)
- 55 tests.

## 0.5.1

- The agents section sits in a round frame in the agents colour, like the other panels, and its title takes that colour too. Cards, rails and lanes are laid out inside it, 4 cells narrower: three cards now need a 66-column pane (62 before), and the lanes' time axis gives up those 4 cells while the 19 cells before it stay put. The expanded card stays below the frame, and the log gives up the frame's 2 rows.
- The agents title truncates instead of running past its frame at 40 columns; the `1-k expand` hint shows only when it fits beside it.
- Rails and the lanes' trunk carry a comet on the wire instead of a dot and a bullet: a 2-cell thick, bold head (`━` along a line, `┃` down the trunk), then a 3-cell trail in the line's own glyph that fades into the dim rest. Marks and branches keep their glyph under it. Spacing and speed are unchanged.
- Clawd stands centred at the foot of the pane instead of on the right.
- New `cost` option (`on`/`off`, default `off`): off, the pane draws no dollar amount, neither the session's cost (main panel, inline summary) nor the turn's (receipt). The figures are still tracked.
- 47 tests.

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
