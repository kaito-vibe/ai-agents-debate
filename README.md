# AI Agents Debate

A local-first desktop app that lets AI personas argue both sides of any topic. Cast a panel of real public figures or fictional archetypes, run structured debates, watch a live score bar shift as arguments land, and get a full analysis report at the end.

![AI Agents Debate](https://img.shields.io/badge/built%20with-Node.js%20%2B%20React-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## What it does

- **Debate mode** — 12 seats at the table, split FOR vs AGAINST (or free-form). Agents speak in turns, directly counter each other, and a neutral judge scores each round in real time.
- **AI persona suggestions** — paste a topic, get 12 fully cast personas with rich 4-paragraph instructions, including real public figures with Wikipedia links and photos.
- **Live score bar** — tracks which side is winning round by round, with full score history and sparklines.
- **Debate summary** — when you end a debate, generates a structured Markdown analysis: result, score movement per round, key arguments, turning points, final verdict.
- **Meeting mode** — classic roundtable with up to 6 participants, agenda items, meeting context, and auto-generated minutes.
- **Debate history** — tabbed view of all saved debates with completion status, verdicts, and sparkline score trajectories.
- **Multi-provider** — works with OpenAI, Anthropic, and Google Gemini. Each agent can use a different provider/model.

---

## Quickstart

**Requirements:** Node.js 18+

```bash
git clone https://github.com/kaito-vibe/ai-agents-debate.git
cd ai-agents-debate
node server.js
```

Opens at `http://localhost:3000` (auto-increments port if busy).

---

## Setup

1. Click **Settings** on the home screen
2. Enter your API key(s) — OpenAI, Anthropic, and/or Google
3. Set your default provider and model
4. Hit **New Debate** and enter a topic

Your API keys are stored locally in `saves/_settings.json` and never leave your machine.

---

## Supported models

| Provider | Models |
|---|---|
| OpenAI | GPT-5.4 Mini, GPT-5.4, GPT-5.4 Pro |
| Anthropic | Claude Haiku 4.5, Claude Sonnet 4.6, Claude Opus 4.6 |
| Google | Gemini 2.0 Flash, Gemini 2.5 Pro |

Custom model names are also supported via the Settings panel.

---

## How a debate works

1. **Setup** — enter a topic, pick FOR vs AGAINST or free-form format
2. **Cast** — use AI persona suggestions or add participants manually
3. **Run** — click **Run Rounds** and set the number of rounds, or trigger individual agents manually
4. **Score** — a neutral judge evaluates each exchange and moves the score bar in real time
5. **Finish** — click **Finish** to generate a full debate analysis report

---

## Project structure

```
ai-agents-debate/
├── index.html      # Full React app (single file, Babel standalone)
├── server.js       # Node.js HTTP server + API proxy
├── package.json
└── saves/          # Local data (gitignored)
    ├── _settings.json
    ├── _personas.json
    └── *.json      # Saved debates and meetings
```

The entire frontend is a single self-contained HTML file using React 18 + Babel standalone + Tailwind CSS — no bundler, no build step.

The server acts as a local proxy to the AI APIs (OpenAI, Anthropic, Google) to keep your API keys off the client and enforce a domain whitelist.

---

## Building a standalone .exe (Windows)

```bash
npm install
npx pkg . --compress GZip --output dist/AIAgentsDebate.exe
```

Produces a self-contained ~36MB Windows executable. Double-click to launch — no Node.js required.

---

## License

MIT
