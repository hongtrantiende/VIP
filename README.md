# VIP

A local-first creative writing workspace built for Vietnamese writers and translators. All data lives in the browser — no account required, no server-side storage.

## Features

- **Local-first data** — Novels, chapters, characters, and notes stored in IndexedDB. Optional backup/restore with encryption and cross-device sync.
- **Multi-provider AI chat** — OpenAI, Anthropic, Google, Groq, Mistral, xAI, OpenRouter, or any OpenAI-compatible API. Context-aware chat that understands the open novel, with file attachments and tool-based data editing.
- **Analysis & Auto-Write** — Three-phase analysis pipeline (chapter → novel → character). Six-step writing pipeline (context → direction → outline → writer → review → rewrite) with smart mode and hands-free execution.
- **Chinese → Vietnamese translation** — Quick Translator with QT dictionaries, name dictionaries, live preview, and name detection. Advanced find & replace (regex, rules, bulk) with diff view.
- **Text-to-Speech reader** — Multiple TTS providers, adjustable speed, sentence highlighting, OS media controls.
- **Web scraper** — Import chapters from novel sites via URL, with a companion browser extension for CORS bypass.
- **WebGPU inference** — Run small models directly on the browser GPU — no API key needed for local chat.
- **Vietnamese UI** — All labels, prompts, and instructions in Vietnamese with optimized font rendering.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | Dexie 4 (IndexedDB) |
| AI | Vercel AI SDK v6 + provider SDKs |
| State | Zustand 5 |
| Package manager | pnpm |

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Installation

```bash
git clone https://github.com/hongtrantiende/VIP.git
cd VIP
pnpm install
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app runs entirely in the browser — no backend services to configure.

### Build

```bash
pnpm build
pnpm start
```

### Lint

```bash
pnpm lint
```

## Project Structure

```
app/
├── (landing)/              # Marketing landing page (/)
├── (dashboard)/            # App shell (sidebar + chat + panels)
│   ├── dashboard/          # Home / stats
│   ├── library/            # Novel library
│   ├── import/             # Book import (TXT, EPUB, DOCX, PDF)
│   ├── convert/            # Standalone QT convert tool
│   ├── scraper/            # Web scraper
│   ├── settings/           # Providers, instructions, data, changelog
│   └── novels/[id]/        # Novel detail, chapter editor, reader, auto-write
├── api/                    # Feedback & sync endpoints
components/
├── ui/                     # shadcn/ui primitives
├── chat/                   # Chat panel components
├── writing/                # Writing pipeline UI
├── reader/                 # TTS reader
├── name-dict/              # Name dictionary panel
lib/
├── ai/                     # AI provider dispatch, tools, system prompts
├── analysis/               # Three-phase analysis pipeline
├── writing/                # Six-step writing orchestrator + agents
├── chapter-tools/          # Bulk convert, translate, name extraction
├── hooks/                  # Dexie entity hooks (use-*.ts)
├── stores/                 # Zustand stores (ephemeral UI state)
├── workers/                # Web Workers (QT engine, replace engine)
├── scraper/                # Site adapters + extension bridge
├── search/                 # MiniSearch global search
├── tts/                    # TTS providers + player
├── import/                 # Book import + chapter splitting
├── db.ts                   # Dexie database + entity types
└── db-migrations.ts        # Schema versions (v1–v11)
```

## AI Configuration

VIP requires you to bring your own API keys. Go to **Settings → AI Providers** to add providers:

| Provider | Type |
|---|---|
| OpenAI | `openai` |
| Anthropic | `anthropic` |
| Google Gemini | `google` |
| Groq | `groq` |
| Mistral | `mistral` |
| xAI (Grok) | `xai` |
| OpenRouter | `openrouter` |
| Any OpenAI-compatible | `openai-compatible` |
| Browser GPU | `webgpu` (chat only) |

## Browser Extension

A companion Chrome extension (`public/novel-studio-connector.zip`) provides CORS bypass for the web scraper. Install it from the public directory or build with:

```bash
pnpm zip:ext
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

[MIT](LICENSE) - hongtrantiende
