# WikiKai

**Build knowledge with AI. Keep it ready to use.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-blue)](https://modelcontextprotocol.io/)

WikiKai is a self-hosted, **AI-native wiki**. Your AI assistant can search, read, create and update documents directly through MCP. Turn conversations into notes, reports, guides and courses, then keep improving them together.

**Explore the live guides:** [English](https://wikikai.cupcode.cc/share/13ba4a37236542d3fe696d74822cc5b18aae2c5105724867) · [Thai](https://wikikai.cupcode.cc/share/291f7ba534b36287d2004812295b825aacd738d7ce83d91c)

Both guides include working examples of every block type, reusable prompts, and public and password-protected sharing.

## Why WikiKai?

- **Let AI do the work.** Create documents, edit sections, update tables, and upload images and files through MCP.
- **Pick up where you left off.** Organize knowledge into projects and pages, then ask AI to find and reuse it in your next conversation.
- **Point to exactly what you mean.** Reference a document with `&N`, a page with `#N`, or a table, chart or other supported block with `@N`.
- **Make knowledge easy to understand.** Combine Markdown, diagrams, charts, KPI cards, step cards, interactive checkboxes, galleries, code and custom HTML layouts.
- **Share with your audience.** Publish a read-only link, or require a document-specific username and password with optional expiry for each reader.
- **Keep control.** Self-host your data, manage project permissions, and review page revisions and optional prompt history.

## From conversation to knowledge

Tell your connected AI what you need:

> Save these meeting notes in WikiKai. Separate decisions from next actions, and add a table of owners and due dates.

> Update the chart at @47 with the new figures, then revise the summary to match.

> Turn our onboarding notes into a training course with lessons, exercises, screenshots and downloadable practice files.

Open the result in your browser, review it, copy an ID, and keep the conversation going. AI can retrieve a specific block or selected table rows when it only needs part of a document.

Sharing settings are managed in the web portal; AI prepares the document through MCP.

## Run locally

Requires **Node.js 20.12+** and npm.

```bash
git clone https://github.com/tharayuth/wikikai.git
cd wikikai
npm ci
cp .env.example .env
npm run build
HOST=127.0.0.1 npm start
```

Open [localhost:3939](http://localhost:3939). For development with hot reload, run `npm run dev` and open [localhost:5173](http://localhost:5173).

## Connect your AI

Add WikiKai to an AI client that supports **MCP over Streamable HTTP**:

| Setting | Value |
|---|---|
| Server URL | `http://localhost:3939/mcp` |
| Authorization, when enabled | `Authorization: Bearer <your-token>` |

For a hosted instance, use its HTTPS URL followed by `/mcp`. With web authentication enabled, find your personal **MCP API token** and an example configuration in the account menu.

The optional [WikiKai skill](docs/skill/SKILL.md) gives compatible agents guidance on when to save knowledge and how to work with pages and blocks.

## Under the hood

**TypeScript · React · Express · SQLite · Markdown · Mermaid · Chart.js**

Document metadata and search indexes live in SQLite. Page content is stored as Markdown files, with images and attachments alongside them.

- [Configuration](.env.example) — storage, authentication and server settings.
- [Deployment](DEPLOY.md) — production builds and hosting.
- Development checks: `npm run typecheck` and `npm test`.

Ideas, bug reports and pull requests are welcome.

[MIT License](LICENSE) · Created by Tharayuth Kaewma.
