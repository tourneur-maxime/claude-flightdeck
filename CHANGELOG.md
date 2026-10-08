# Changelog

## 0.9.2

- The comets on the links (main to the architect, to the gate, to the agents) stay 24 cells apart. They looped over the rail's width plus 24, so on a rail whose width is not a multiple of 24 the gap between the last comet and the first closed (to 16 cells on a 58-cell rail) each time one came back in at the left. A cell's level now comes from its own distance behind the nearest head, as on the agents' trunk.
- 93 tests.

## 0.9.1

- No digit before a lane's title: the lanes lose their hotkeys `1` to `9` and the `1-9 card` hint; a click on the title opens the card.
- 92 tests.

## 0.9.0

- The agents are swimlanes again: one row per agent off the animated trunk, in the tree's order, with its state, its task, its time on a shared axis and its clock. Every agent kept (the latest 24) has its lane.
- A lane's title, or its hotkey (`1` to `9`), opens its agent's card right under the lane, as the 0.8 card drew it (type and model, verdict, context gauge, state, messages); press it again to close it. One lane is open at a time; the trunk grows by the card's 7 rows beside it.
- The card's `inspect ›` opens the agent view; a lane alone no longer does. The agents hint reads `1-9 card`.
- The agent view opens at its top, not at the end; the end is followed again once you scroll down to it. Opening it puts the focus on `back`, asking the keyboard back for the pane when the prompt took it, so `b`, `p`, `n` and `i` can reach the pane; the surface may refuse (text in the composer, a dialog), and the log then says to press ctrl+x tab. Its bottom has `‹ back`, `‹ prev` and `next ›` too.
- Clawd is an SVG on the desktop app, VS Code and mobile: their font drew his block glyphs as separate boxes. He stands still there; the terminal keeps the animated glyphs.
- 92 tests.

## 0.8.1

- The agent's conversation opens in the Flightdeck pane itself, in place of the dashboard, instead of in a second pane. The second pane stayed behind Flightdeck until you clicked its tab: the API cannot bring a pane to the front. `$.ui.open({ focus })` is a request, refused while the pane the person holds keeps the keys, and the pane whose card was just pressed holds them; nothing else raises a pane. The `flightdeck-agent` pane is gone.
- The agent view: Clawd at the top, as on the dashboard; a row of controls, `b: back`, `p: ‹ prev`, `n: next ›` (the agents in the cards' order, dim at either end) and `i: summary`; the heading `Agent · <task> · ◐ running · sonnet`, the task cut first when the pane is narrow; then the summary and the conversation, drawn as before. Hotkeys take one digit or lowercase letter only, so prev and next are `p` and `n`, not `[` and `]`.
- `b` goes back to the dashboard, at its top, and drops the conversation; so do `/flightdeck close`, `/flightdeck reset`, the pane closing and the end of the session. An agent whose card leaves the list takes the pane back to the dashboard. `/flightdeck reset` no longer leaves a read of the agent's conversation running.
- Following the end works on the Flightdeck pane, only while an agent is in view. The inline summary (`mini`) never shows the agent view.
- 87 tests.

## 0.8.0

- The agent pane: a click on a card's title, or its hotkey (`1` to `9`), opens a second pane, `flightdeck-agent`, titled `Agent · <task>`, focused, as a tab beside Flightdeck; `Esc` closes it, another card switches it to that agent. It shows the agent's whole conversation from `$.session.messages({ agentId })`: `▶ user` and `◆ assistant`, the text wrapped, each tool call on one line (`⚒ Bash → …`, `✗` in red on an error) with the first 3 lines of its result and `… (+N lines)`, credentials masked, as plain text. Only the newest 400 messages and 60 000 characters are kept, under `… N earlier messages`; one message's text is cut at 6 000 characters, and a message too big on its own gives up its earliest tool calls (`… (+N tool calls)`), counted as stored.
- The conversation is read in hooks, never while drawing: when the pane opens, then while the agent runs after its model requests and tool calls, at most once a second, and once more when it ends. The pane keeps the end in view until you scroll away from it, and again once you scroll back to the last row.
- For an ended agent the session no longer serves, the pane reads its saved transcript (JSONL, at most 4 MiB), at the path `SubagentStop` names, else beside the main transcript, else rebuilt from the config directory, the working directory and the session id; otherwise it says `transcript unavailable: <why>`.
- The expanded card leaves the main pane: its summary is the agent pane's, on `i`. The agents hint reads `1-9 open`.
- `/flightdeck close` closes the agent pane too; so does the end of the session.
- A read that fails says why in the pane (`transcript unavailable: …`, credentials masked, a path cut to its file name) instead of leaving it on `reading…`.
- 81 tests.

## 0.7.0

- A card has 5 rows; the trunk runs 7 rows beside each.
- A review agent's verdict at the right end of its type and model row: `BLOQUANT` in red and bold, `MINEUR` in amber, `OK` in green, read from its whole final report (the word after "verdict", bold or between backticks, else the gravest anywhere: a `BLOQUANT` in capitals that is not negated, then a `MINEUR`, then an `OK` in bold), with a log line. Only agents whose task matches the new `verdictPattern` option get one (default `v[ée]rif|verify|review|check|audit`).
- Messages between agents: `session.send` and `session.receive`, watch only. A fifth row counts the messages a card received and sent (`✉ 2 in · 1 out`, or `✉ —`); for 2.5 s after one its border turns amber. The log says who wrote to whom with the message's start, credentials masked (`main → <task> · « … »`). A send and its delivery are matched in order; a send still waiting after 60 s is dropped. A task notification marks its agent's card and counts as no message.
- A resumed agent runs again: a message delivered to an ended card, or a new step of its own, sets it running; its next `turn.complete` ends it.
- A context gauge on the third row: `ctx ▰▰▰▱▱▱▱▱ 38% · out 3k · 7 steps`, against the window the main loop was measured on for that model (learnt only from a measurement), `~` when it is inferred (another model, or the same under another variant), amber from 70 %, red past 90 %; narrower, the gauge takes 4 cells, then none. With no measurement yet, `ctx 12k` as before.
- An agent's own compactions are counted on its card (`⟲N`) and logged with the sizes before and after.
- 66 tests.

## 0.6.0

- The agents section is a list: one card per agent, one under the other, every card kept (the latest 24) at the frame's full inner width, each sub-agent right after its parent. Swimlanes and their time axis, `+N earlier`, the cards side by side and the fan-out and merge rails are gone; the pane scrolls when the list is long.
- A card has 4 rows: the task (hotkeys `1` to `9`, the cards after the ninth expand by a click); its type and model, the model always shown and in short (`opus`, `sonnet`, `haiku`, or the model's name), with `↳ parent` beside it for a sub-agent when it fits; context, output and steps; its state (`◐ running`, `✓ done`, `✗ failed`, `■ stopped`, `max_tokens` in red) with its clock. The expanded card is unchanged.
- The trunk runs down the left of the cards, 6 rows beside each: a branch on each card's top row, and a `┬` where a parent's children hang, their line running down beside the parent's card. The comet still runs down it and out along each running agent's branch.
- Clawd stands at the top of the pane, centred above the model line, instead of at its foot; the docked pane no longer stretches to its full height to centre him.
- The `maxCards` option is gone: with a list, there is nothing to cap side by side. A value left in settings is ignored.
- The desktop's SVG time axis draws a bar for every card, in the list's order.
- A card's rows are cut in terminal cells, not characters (`cellWidth`, `shortenCells`): a CJK or emoji title takes 2 cells a character, is never cut mid code point, and its row is held to one line, so a card stays 6 rows tall beside the trunk.
- 54 tests.

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
