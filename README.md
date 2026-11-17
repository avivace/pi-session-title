# pi-live-title

A [pi](https://pi.dev) extension that names your session after what you're
working on. Pi already shows the session name in the terminal tab title
(`pi - <name> - <cwd>`) and in `/resume`, so tabs stay recognizable without
you running `/name`.

## How it works

- After the first prompt settles, a short LLM call summarizes your recent
  requests into a 2-6 word title and sets it with `pi.setSessionName()`.
- Every `every` prompts (default 5) it re-evaluates; the title only changes
  when the topic has clearly shifted.
- A name you set yourself (`/name`, `--name`, `/title <text>`) is never
  overwritten.
- Runs only in interactive/RPC mode, after the agent is idle, and never
  blocks or errors into your session.

## Install

```bash
pi install npm:pi-live-title
```

or from git:

```bash
pi install git:github.com/avivace/pi-session-title
```

## Commands

| Command | Effect |
|---|---|
| `/title` | Regenerate the title now |
| `/title <text>` | Set the title manually (and lock it) |
| `/title auto` | Unlock and go back to automatic titles |
| `/title stats` | Show title calls and token usage for this session |

## Configuration

Optional, in `~/.pi/agent/settings.json`:

```json
{
  "liveTitle": {
    "enabled": true,
    "every": 5,
    "model": "provider/model-id"
  }
}
```

`model` defaults to the session's current model. A small, fast model is
enough and cheaper. The request includes your recent prompts (truncated),
the working directory and an excerpt of the last reply.

## Token cost

Each call sends at most the last 12 prompts (400 chars each) plus a
600-char excerpt of the last reply, and gets back a few tokens: roughly
0.5-2k input and under 15 output tokens. It runs once after the first
prompt, then once every `every` prompts, so a 30-prompt session makes about
7 calls. Usage is recorded in the session file as `live-title-usage`
entries; `/title stats` sums them (cost shows `$0` for models without
catalog pricing).

## tmux

Pi sets the title with `OSC 0`. Inside tmux that only sets the pane title
(`#T`): it is neither forwarded to the outer terminal nor shown in the
status bar by default. To use it, add to `~/.tmux.conf`:

```tmux
# Outer terminal tab/window title follows the active pane's title
set -g set-titles on
set -g set-titles-string '#T'

# Window names follow the pane title too
setw -g automatic-rename on
setw -g automatic-rename-format '#{pane_title}'
```

Panes that never set a title show the hostname. To fall back to the running
command instead:

```tmux
setw -g automatic-rename-format '#{?#{==:#{pane_title},#{host}},#{pane_current_command},#{pane_title}}'
```

Reload with `tmux source-file ~/.tmux.conf`.

## License

MIT
