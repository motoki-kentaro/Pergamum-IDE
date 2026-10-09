<p align="center">
  <img src="assets/logo/logo-mono.svg" alt="Pergamum" width="457">
</p>

<h1 align="center">Pergamum</h1>

<p align="center"><strong>IDE for novelists</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/motoki-kentaro/Pergamum-IDE/ci.yml?branch=main&label=CI)](https://github.com/motoki-kentaro/Pergamum-IDE/actions/workflows/ci.yml) [![Version v0.90.1](https://img.shields.io/badge/version-v0.90.1-blue)](https://github.com/motoki-kentaro/Pergamum-IDE/releases/tag/v0.90.1) [![License MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) [![Electron 44](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](./package.json) [![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](./package.json) [![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](./package.json)

[日本語](./README.md) | [English](./README.en.md)

## What is Pergamum?

Pergamum is an **open-source IDE for novelists**. It brings manuscript editing, story-world information, search, preview, and export together in one project. It is free software under the MIT License.

<p align="center">
  <img src="docs/manual/assets/main_image.png" alt="Pergamum writing workspace" width="1000">
</p>

## for novelist

As a story grows, so does the information surrounding it: character names, aliases, places, and world-building notes. Pergamum **separates the place where you write from the place where you manage what you know about your story, while keeping both in one writing environment**.

Ordinary Markdown / TXT files on your own computer are the source of truth for your manuscript. Structured story information, such as characters and terms, lives in a SQLite `.pergamum` project file. Your manuscript remains readable in other text editors, without having to fit the database's structure.

The goal is not to write novels on the author's behalf, but to build **a tool that helps authors remember what they have already decided**. Pergamum does not rewrite your manuscript on its own: text changes and completion follow the operations and settings you choose.

Focus on writing while keeping your manuscript on your own computer. Getting started does not require entrusting your work to a particular service.

- **Completely free / [MIT License](./LICENSE)**
- **No account required**
- **No cloud features**
- **Your manuscript files are not sent to external services**
- **No AI writing, text generation, or editing features**
- **No PC administrator privileges required to install the Windows version**
- Your manuscript stays on your computer as ordinary **Markdown / TXT files**. You can open it in other text editors even if you stop using Pergamum.

Pergamum is developed with generative AI assistance, but the product itself has no AI writing, text generation, or editing features. The author creates the story and chooses the words.

## for Engineer

Alongside fiction, Pergamum has room for technical notes and design documents. Combine prose, diagrams, equations, and code in a single Markdown document to put your ideas in context.

- **GitHub Alerts (callouts)** — Make notes and warnings stand out from the surrounding text.
- **Mermaid syntax** — Describe diagrams and flowcharts in text.
- **KaTeX syntax** — Write and display mathematical expressions.
- **Syntax highlighting** — Display code blocks with language-aware coloring.

Use the horizontal Markdown preview to check the presentation as you write. Search and project management also help you keep related notes together.

## v0.90.1 — BETA

The core features of a novelists' IDE are now in place, and **Pergamum v0.90.1 BETA is available as the first public release**. A Windows NSIS installer is provided through GitHub Releases.

The project is now entering a feedback-driven phase. Bug reports, rough edges, workflow problems, and requests for new features based on actual writing are welcome.

This is not the stable 1.0 release. Project database schemas and compatibility may undergo breaking changes before 1.0. Protect important manuscripts and story data by keeping the entire project folder in Git or ordinary backups as well.

## Features

| Area | What you can do |
| --- | --- |
| Manuscript editing | Edit and save Markdown (`.md`) and plain text (`.txt`) in tabs. Choose supported formats in project settings; `.txt` supports encodings including UTF-8, Shift_JIS (CP932), EUC-JP, ISO-2022-JP, and UTF-16. |
| Projects and files | Manage a story through `.pergamum`; create, move, rename, and delete files and folders in File Explorer. Projects and Markdown passed at startup or while running are routed to the appropriate window, starting a separate process when needed. |
| Search and navigation | Search and replace within a document or across a project, with regular expressions and Glossary-based search. Use Quick Open, heading navigation, and the Command Palette to reach files and actions. |
| Glossary | Manage characters, places, terms, aliases, tags, and Description text. Refer to story information through Hover Cards, completion candidates you choose, and navigation to occurrences in the manuscript. |
| Preview | View Markdown and Aozora Bunko notation, ruby annotations, emphasis dots, callouts, and images. Bidirectional editor–preview scroll sync keeps your writing and reading positions aligned. |
| Document overview and metrics | Navigate from the Document Map and export the map as PNG. Document Metrics shows character counts, Japanese manuscript-paper estimates, dialogue ratio, term occurrence counts, and more. |
| Export | Review the selected manuscripts and their order, then export TXT (UTF-8), HTML, or PDF. PDF supports horizontal and vertical writing. |
| Resume and recover | Session restore, Recovery for unsaved text, atomic saving through a temporary file followed by replacement, and a write lock against simultaneous writes to the same project. |
| Images and assets | Paste and save images, open an image viewer, diagnose broken image links, and update image links and references when files move. |
| Controls and appearance | A Markdown toolbar, customizable shortcuts, application and project settings, and themes including light and dark. Use Tab for focus movement and separate indent/outdent operations. |

Enable direct `.txt` editing in project settings. Markdown-specific features such as preview and heading navigation do not apply to `.txt`. See the [User Manual](https://pergamum-ide.github.io/en/) for guidance; the English manual is currently a placeholder, while the [Japanese manual](https://pergamum-ide.github.io/ja/) is available.

## Safety and data model

| Location | Role |
| --- | --- |
| Markdown files | The source of truth for the manuscript, stored as ordinary human-readable text. Use `.txt` when writing in plain text. |
| `.pergamum` (SQLite) | The source of truth for structured story information such as characters and terms, and the entry point for opening a project. |
| `pergamum.json` | Project settings. |
| Session / Recovery in application data | The previous working environment and working copies of unsaved text. |

Session restores your working environment, such as open tabs; Recovery retains unsaved text as recovery candidates. Restoring a candidate opens a separate file instead of directly overwriting the original manuscript. **Recovery is not a substitute for version history, Git, or backups.**

The [User Manual](https://pergamum-ide.github.io/en/) covers saving and recovery (English content is pending; see the [Japanese manual](https://pergamum-ide.github.io/ja/)). The [ADR index](./docs/adr/README.md) records the Glossary model and persistence and recovery designs. ADRs also include future designs, so distinguish their decision status from implementation status.

## Installation and Development

### Windows

For Windows, Pergamum provides an **NSIS installer**. **No PC administrator privileges are required for installation.**

The installer can be used to install Pergamum and also supports file association for `.pergamum` project files.

**[Download Pergamum v0.90.1 BETA from GitHub Releases](https://github.com/motoki-kentaro/Pergamum-IDE/releases/tag/v0.90.1)**

### macOS / Linux

Official prebuilt packages for macOS and Linux are not currently provided.

If you want to use Pergamum on a non-Windows platform, please build it from source.

### Running from source

Development and source builds require **Node.js 24** (`>=24 <25`).

```bash
git clone https://github.com/motoki-kentaro/Pergamum-IDE.git
cd Pergamum-IDE
npm ci
npm run dev
```

### Validation and packaging

Run the TypeScript typecheck, test suite, and application packaging with:

```bash
npm run typecheck
npm test
npm run build
```

To build the Windows NSIS installer:

```bash
npm run build:installer
```

The generated installer is written to `dist-installer/`.

## Feedback and feature requests

Pergamum is moving from building out features to **gathering feedback from actual use**. If you try the BETA, please share bugs, usability problems, and ideas for new features through [GitHub Issues](https://github.com/motoki-kentaro/Pergamum-IDE/issues).

For bug reports, the application version, OS, steps to reproduce, and expected behavior help with investigation. For feature requests, tell us which part of your writing workflow needs help. You do not need to attach private manuscripts.

## Manual and development resources

- [User Manual (English)](https://pergamum-ide.github.io/en/) — Currently a placeholder; the English manual is coming later.
- [User Manual (Japanese)](https://pergamum-ide.github.io/ja/) — From your first manuscript to representative features.
- [Roadmap](./docs/roadmap.md) — Future direction and ideas under consideration. Individual Issues define implementation scope.
- [ADR](./docs/adr/README.md) — Design decisions and their rationale.
- [GitHub Issues](https://github.com/motoki-kentaro/Pergamum-IDE/issues) — Bugs, requests, and development work.

## Current limitations

- Pergamum is BETA, with development and distribution focused on Windows. Equivalent behavior and distribution on other operating systems are not guaranteed.
- Long-term project database compatibility is not guaranteed before 1.0. Back up both manuscripts and structured data.
- DOCX/EPUB export, cloud synchronization, and collaborative editing are not implemented.
- PDF fonts and layout depend on your environment and manuscript. Review export warnings and inspect the output before distributing it.

## License and third-party notices

Pergamum is released under the [MIT License](./LICENSE).

See [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) for bundled dependencies and Electron, and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for attribution and licenses of icons, sound effects, and other assets.

## Origin of the name Pergamum

Pergamum (Πέργαμον) was an ancient Greek city that once flourished in Asia Minor (present-day western Turkey). It was home to a great library that rivaled the Library of Alexandria, and its name also gave rise to the word “parchment.” This product takes its name from that city.
