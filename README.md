# pi-session-title

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
pi install git:github.com/avivace/pi-session-title
```

## Commands

| Command | Effect |
|---|---|
| `/title` | Regenerate the title now |
| `/title <text>` | Set the title and lock it |
| `/title auto` | Unlock and go back to automatic titles |

## Configuration

Optional, in `~/.pi/agent/settings.json`:

```json
{
  "sessionTitle": {
    "enabled": true,
    "every": 5,
    "model": "provider/model-id"
  }
}
```

`model` defaults to the session's current model. A small, fast model is
enough and cheaper. The request includes your recent prompts (truncated),
the working directory and an excerpt of the last reply.

## License

MIT
