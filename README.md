# Flightdeck

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B%20mod-d97757.svg)](https://claude.com/blog/claude-code-mods)

**A Claude Code mod that puts a live agent dashboard in your terminal**: context and rate limits, an advisor timeline, every permission check, and your subagents as a list of cards. Every number comes from a real session event, and nothing leaves your machine.

<p align="center">
  <img src="docs/media/demo.gif" alt="Flightdeck during a live session: five audit subagents run and finish as a list of agent cards, while the permission gate fills with checks" width="520">
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#what-you-see">What you see</a> · <a href="#what-it-can-reach">What it can reach</a> · <a href="#configure">Configure</a> · <a href="#troubleshooting">Troubleshooting</a>
</p>

## Install

Inside Claude Code (2.1.287 or later):

```
/plugin marketplace add scasella/claude-flightdeck
/plugin install flightdeck@claude-flightdeck
/reload-plugins
/flightdeck
```

<details>
<summary><strong>From the terminal, or from a clone</strong></summary>

```sh
claude plugin marketplace add scasella/claude-flightdeck
claude plugin install flightdeck@claude-flightdeck
```

Or load it straight from a clone, for one session:

```sh
git clone https://github.com/scasella/claude-flightdeck
claude --plugin-dir ./claude-flightdeck
```

</details>

The installer may say config options aren't set; the defaults are fine, and [`/config`](#configure) changes them.

Mods are an early-access Claude Code feature and their API can change between releases. If something breaks, see [Troubleshooting](#troubleshooting).

## What you see

https://github.com/user-attachments/assets/9ad0fcc3-c81c-427a-a743-f7b6c49f5885

<p align="center">
  <img src="docs/media/docked-session.png" alt="Claude Code in fullscreen with the Flightdeck pane docked beside the transcript" width="820">
</p>

| Docked beside the transcript | Inline above the prompt |
| --- | --- |
| <img src="docs/media/docked-pane.png" alt="The docked pane: main model vitals, architect timeline, permission gate, five agents as a list of agent cards, last-turn receipt and session log" width="380"> | <img src="docs/media/inline-mini.png" alt="The inline mini layout: the model, context gauge, session cost and architect consults; the permission gate strip and totals; the last turn's duration, agents, edits, errors and cost" width="420"><br><br>On the main screen, without fullscreen, the pane is a summary of at most 8 rows; up to 3 agents join it when the session has subagents. |

| Panel | Shows | From |
| --- | --- | --- |
| **main** | model, effort, permission mode, request count; a context gauge with compactions (⟲); the first two rate-limit windows when your plan reports them, and the session's cost under `cost: on` | `turn.step`, `session.measure`, `session.compact`, `$.session.usage()` |
| **architect** | consults on a timeline, whether one is running, how long the last took; optionally the moment of each consult; the first line of a subagent architect's advice | a spawn of a matching agent type, or a matching server tool in the assistant's rows |
| **gate** | one cell per permission check: green allowed without asking, blue decided by the auto-mode classifier or you and then run, amber pending, red ✗ denied, dim if made inside a subagent. Totals, and a drill-down per tool family with credentials masked | `tool.check`, settled by the `tool.call` around it |
| **agents** | a card per agent, one under the other, every one kept (the latest 24), 5 rows each: the task; its type and model (`opus`, `sonnet`, `haiku`, or the model's name), with a review agent's verdict at the right end (`BLOQUANT` in red, `MINEUR` in amber, `OK` in green); a gauge of its context against its window (`ctx ▰▰▰▱▱▱▱▱ 38%`, `~` when the window is inferred, amber from 70 %, red past 90 %), output, steps and its own compactions (⟲); its state with a running clock, `max_tokens` in red; the messages it received and sent (`✉ 2 in · 1 out`), its border flashing amber for 2.5 s after one. An ended agent that a message resumes runs again. The cards hang off one trunk that starts under the header, a branch (`├─`, the last `└─`) on each card's top row. Sub-agents sit right under the agent that spawned them, at any depth: one level further along the trunk, `↳ parent` beside the model when it fits, the parent in the agent pane's summary. A card's title opens the agent pane | `agent.spawn` (with its `parentAgentId`), `turn.step`, `tool.call`, `turn.complete`, `session.send`, `session.receive`, `session.compact`, `session.measure` |
| **loops** | model loops that match no card: workflow agents, compactions, memory forks | `turn.step` ids no card claims |
| **receipt** | the running turn, or the last one: duration, agents, edits, errors, and the cost added under `cost: on` | `turn.start`, `turn.complete` |
| **log** | prompts, spawns, completions, verdicts, messages between agents (`main → <task> · « … »`, in amber), compactions, consults, edits, errors and denials; filtered to one agent while you view its transcript | all of the above |

**The agent pane.** A click on a card's title, or its hotkey, opens a second pane, `Agent · <task>`, as a tab beside Flightdeck: that agent's whole conversation. Each message under `▶ user` or `◆ assistant`, the text wrapped; each tool call on one line (`⚒ Bash → git status`, `✗` and red when it failed) with the first 3 lines of its result and `… (+N lines)`; credentials masked. A long conversation shows its newest 400 messages and 60 000 characters under `… N earlier messages`. While the agent runs the pane reads it again at most once a second, and keeps the end in view unless you scroll up (scroll back to the end to follow again). `i` shows the card's summary above it: the full task, its parent, the last 3 tool calls, the start of its answer. Another card's title switches the same pane to that agent; `Esc` closes it. For an ended agent the session no longer serves, it reads the agent's saved transcript instead (`· from the saved transcript`), or says why it can't (`transcript unavailable: …`).

Connectors animate only while work flows: a turn is running, an agent is running, or a consult is open. On the agents' trunk a comet runs down to each running agent's card and out along its branch; an ended agent's branch stays dim, and so does its card's border. Panels with nothing to show take no room, so a session without subagents shows just the main box and the log.

Clawd, Claude Code's own mascot, stands centred at the top of the pane in his own colours, above the model line: he waves while an agent runs, blinks now and then while the main loop works, and stands still otherwise. He is not drawn in the inline summary, nor in a pane narrower than 40 columns; `mascot: off` leaves him out.

## Use

| Command | Does |
| --- | --- |
| `/flightdeck` | open the pane |
| `/flightdeck close` | close it, and the agent pane |
| `/flightdeck reset` | clear agents, checks, consults, log and the turn (cost, rate limits and compactions stay) |
| `/flightdeck layout auto\|compact\|wide\|mini` | override the layout for this session |

Focus the pane with `ctrl+x tab`, then:

| Key | Does |
| --- | --- |
| `1` to `9` | open one of the first nine agents in the agent pane, its whole conversation (a click on any card's title does too) |
| `f` `s` `o` | open the gate's file / shell / other drill-down: the last 5 checks and their verdicts |

In the agent pane:

| Key | Does |
| --- | --- |
| `i` | show or hide the card's summary: its full task, parent, last 3 tool calls, start of its answer |
| `Esc` | close the agent pane |

`/clear` resets the pane along with the conversation.

## Where it runs

- **Fullscreen terminal:** docked beside the transcript; two columns from 110 columns wide.
- **Main-screen terminal:** inline above the prompt, as the 8-row summary.
- **Desktop app, VS Code, mobile:** the same panels, plus the agents drawn as an SVG time axis. VS Code and mobile can't animate, so connectors, the cards' trunk, clocks and Clawd are static there.

With `openOnStart`, the pane opens by itself when a session starts, in terminals at least 144 columns wide; below that, `/flightdeck` opens it. Colours come from your Claude Code theme, so light, dark and colour-blind themes all read.

## What it can reach

Flightdeck only watches. Every hook passes its event on unchanged: it never denies, rewrites or delays a tool call, a prompt or a subagent.

| It sees | Through |
| --- | --- |
| every tool call's name and input, and whether it failed | `tool.call` |
| every permission verdict | `tool.check` |
| subagent spawns, their model requests and token usage, and their final answers | `agent.spawn`, `turn.step`, `turn.complete` |
| messages between the main loop and agents, or between agents: who to whom, and their first 80 cells, credentials masked | `session.send`, `session.receive` |
| compactions, the main loop's and each agent's, with the sizes before and after | `session.compact` |
| your prompts' first 70 characters, for the log | `turn.start` |
| context, cost and rate-limit readings | `session.measure`, `$.session.usage()` |
| advisor tool calls in the assistant's responses (their content is encrypted) | `session.append` |
| the conversation of the agent you open in the agent pane: its messages, tool calls and the start of their results, credentials masked; the newest 400 messages and 60 000 characters | `$.session.messages({ agentId })`, read when you open it, then while it runs |
| for an ended agent the session no longer serves: its saved transcript, one file of at most 4 MiB, read only | `$.fs.stat`, `$.fs.read`; its path from `classic.SubagentStop` (`agent_transcript_path`), else from any classic event's `transcript_path`, else from `$.env.get` (`CLAUDE_CONFIG_DIR`, `HOME`), `$.session.cwd()` and `$.session.id()` |
| whether you scrolled the agent pane away from its end | `ui.scroll` |

What it keeps: short summaries (a tool name plus a path or command, the start of a message, with credentials masked) in session state, which ends with the session; while the agent pane is open, that agent's conversation too, masked and cut to the budget above, dropped when the pane closes. It makes **no** network requests, runs no processes, writes no files, reads one only for the agent pane's fallback (an agent's saved transcript), stores nothing across sessions, and calls no model. `claude plugin validate .` prints exactly what it hooks and calls.

## What is inferred, not measured

- **Architect moments.** "Before a plan" means no edits yet this turn, "error repeats" means 2+ main-loop errors in a row, "before done" means edits were made. They are labelled `(inferred)`; turn them off with `moments: false`.
- **Server-side advice is encrypted.** For a server tool such as Claude Code's `advisor`, the pane counts and times the consult but cannot show what it said.
- **Per-agent context is the latest request's whole input** (uncached + cache read + cache write). It is labelled `ctx`, not cost: the API has no per-agent cost.
- **An agent's context window.** Only the main loop's window is measured, and a window is learnt only from a measurement, for the model the main loop ran then. An agent on the very model the main loop was measured on gets that window; on another model, or the same model under another variant (`[1m]` or not), its gauge uses the main loop's window and its percentage is marked `~`. Before any measurement the card shows `ctx 12k` with no gauge.
- **Verdicts are a reading of the text.** For an agent whose task matches `verdictPattern`, the badge is the word after "verdict" in its final report (bold or between backticks), else the gravest word anywhere in it: a `BLOQUANT` in capitals that is not negated, then a `MINEUR`, then an `OK` in bold. A report that words its verdict otherwise shows none.
- **Messages are matched in order.** A send and its delivery share no id: a delivery completes the latest send to that recipient, else the latest whose recipient could not be resolved, else the latest. A send that waits more than 60 s for its delivery (one to another session, say) is dropped. A recipient is resolved by agent id, by the name the agent list gives, or by the one card spawned under that name.
- **A resumed agent.** No event says an ended agent was resumed: a message delivered to it, or a new model request of its own, sets its card running again.
- **The flash** ends with a redraw 2.5 s after the message; a surface that does not redraw then shows it until its next drawing.
- **The agent pane's fallback path.** The path `SubagentStop` names, and the folder beside the main transcript, are the engine's own words. Before either is known (right after a reload, before your next prompt), the path is rebuilt as `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<working directory, every character but a letter or digit as ->/<session id>/subagents/agent-<id>.jsonl`, a layout no API documents.
- **Following the agent pane's end.** The pane follows the end until you scroll away from it, and again once you scroll back to the last row or open an agent; it reads at most once a second, so it can lag that much behind the agent.
- **Other loops** can't tell a workflow agent from a compaction fork; both are model loops no card claims.
- **A background agent's first step** can arrive before its card exists, so its usage may show one step late.
- **Top-level placement in the agent tree.** Who spawned whom is measured (`parentAgentId`). But an agent whose parent has no card among those drawn (an architect, or an agent dropped from the list or not shown) is drawn at the top level, beside the main loop's own agents. Its summary in the agent pane still names the real parent: the architect, or `agent` when no card is left. Beside the cards, the trunk column is at most 6 cells wide. Counting the main loop as level 0, the agents it spawned are at level 1, their children at level 2 and theirs at level 3, each one level further along the trunk. An agent deeper than level 3 is drawn at level 3, keeping its own branch (for instance `│ │ └─`) on that level's line, with the levels between omitted; its summary names its real parent.

## Configure

In `/config`, or under `pluginConfigs["flightdeck"].options` in `settings.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `architectPattern` | `advisor\|architect` | case-insensitive regex for agent types and server tools that count as the architect |
| `matchDescriptions` | `false` | also match agent descriptions, not just type names |
| `verdictPattern` | `v[ée]rif\|verify\|review\|check\|audit` | case-insensitive regex for the agent tasks (their description) whose final report carries a verdict shown on the card |
| `architectLabel` | `ARCHITECT` | the architect's name in the pane |
| `gateLabel` | `GATE` | the permission panel's name |
| `panels` | `main,architect,gate,agents,loops,receipt,log` | which panels show, in order |
| `layout` | `auto` | `mini`, `compact`, `wide`, or `auto` (mini inline, wide from 110 columns docked) |
| `motion` | `while-active` | `off` keeps connectors still |
| `moments` | `true` | show the inferred consult moments |
| `palette` | `theme` | `pastel` uses fixed colours tuned for dark terminals |
| `openOnStart` | `true` | ask to open the pane when a session starts |
| `statusLine` | `true` | context, running agents, consults and denials in the status line |
| `mascot` | `on` | `off` leaves Clawd out of the top of the pane |
| `cost` | `off` | `on` shows dollar amounts: the session's cost in the main panel and the inline summary, the turn's in the receipt |

## Troubleshooting

**The pane doesn't appear.**
- Check `claude --version` is 2.1.287 or later, then run `/reload-plugins` and `/flightdeck`.
- Below 144 columns, Claude Code won't seat a pane nobody asked for; `/flightdeck` opens it at any width.
- Look in the transcript for a dim line starting `flightdeck:`. It names the hook that failed or the reason the pane was refused. Please [open an issue](https://github.com/scasella/claude-flightdeck/issues) with it.

**Colours look wrong.** Set `palette` to `pastel` in `/config`.

**It's too much motion.** Set `motion` to `off`; Clawd then stands still too, and `mascot: off` removes him.

**Counters look stale after an update.** Run `/flightdeck reset`.

## How it works

| File | Holds |
| --- | --- |
| [`hooks/register.tsx`](hooks/register.tsx) | the event hooks, state access, and one function per panel |
| [`hooks/core.ts`](hooks/core.ts) | every reducer, formatter and layout rule as pure functions, so behaviour is testable directly |
| [`hooks/rail.tsx`](hooks/rail.tsx), [`hooks/spine.tsx`](hooks/spine.tsx), [`hooks/elapsed.tsx`](hooks/elapsed.tsx), [`hooks/clawd.tsx`](hooks/clawd.tsx) | surface modules: animated connectors, the cards' trunk, live clocks and Clawd, each redrawing only itself on the surface's own frame clock |
| [`types/index.d.ts`](types/index.d.ts) | the state contract |
| [`tests/`](tests) | 77 tests: pure behaviour, plus drawings mounted on every surface at 40–120 columns |

State lives in `$.state` atoms. Every read is merged over defaults, so a missing or older field never breaks the pane; an update that changes the state's shape may still reset its counters once. New to mods? Start with [Claude Code mods](https://claude.com/blog/claude-code-mods) and [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/).

## Related projects

Flightdeck works alongside these, and owes ideas to them:

- [claude-hud](https://github.com/jarrodwatts/claude-hud): context, limits, tools and agents in your status line. Use both: that's the status line, this is the pane.
- [zoetrope](https://github.com/furkankly/zoetrope): a Claude Code or Codex session as a live flow graph.
- [ccusage](https://github.com/ccusage/ccusage): cost reports from your session logs.
- [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods): the index of Claude Code mods.

## Develop

```sh
claude --plugin-dir .            # load it; edits hot-reload
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .       # after the first load, which writes .claude-plugin/types/
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
