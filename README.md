# Markdown Viewer

A minimal Chrome (Manifest V3) extension that renders `*.md` files as
human-readable, GitHub-styled HTML — both local `file://` files and `.md`
files served over the web.

## What it does

When you open a URL whose path ends in `.md`, `.markdown`, `.mkd`, or
`.mdown`, the extension:

- parses the raw markdown with [marked](https://marked.js.org/) (GitHub-flavored),
- syntax-highlights fenced code blocks with [highlight.js](https://highlightjs.org/),
- renders ` ```mermaid ` fenced blocks as diagrams with [Mermaid](https://mermaid.js.org/),
- links Jira ticket keys (`FLYW-123`, `PLT-45`, …) to the ticket,
- replaces the raw text with a clean, GitHub-like layout that follows your
  OS light/dark color scheme.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. To render **local** `.md` files, click **Details** on the extension and
   enable **Allow access to file URLs**.

Open any `.md` file (e.g. drag one into Chrome) and it renders automatically.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest; registers the content script for `*.md` URLs |
| `viewer.js` | Reusable renderer (`MarkdownViewer.parse` / `enhance`); also loads under Node |
| `content.js` | Reads the raw markdown, rebuilds the page via `viewer.js` |
| `markdown.css` | GitHub-like page styling (light + dark) |
| `marked.min.js` | Markdown parser (v4.3.0) |
| `highlight.min.js` | Syntax highlighter (v11.9.0) |
| `mermaid.min.js` | Diagram renderer for ` ```mermaid ` blocks (v11.17.2) |
| `github-light.min.css` / `github-dark.min.css` | hljs themes, picked at runtime |
| `viewer-assets.json` | Which of these files other projects need to load the renderer |

## Notes

- The extension reads the markdown directly from the page Chrome already
  displays, so it works offline and needs no network access.
- Files served as a download (`Content-Disposition: attachment`) or as
  pre-rendered HTML won't be intercepted — it targets raw markdown text.

## Using the renderer in other projects

`viewer.js` has no extension-specific code, so other projects can use it
directly (e.g. `hal-9000` pre-renders its docs site with it):

- **Pin a release.** Check out a tag (`git clone --branch v1.0.0 ...`)
  rather than `master`, and bump it deliberately.
- **Read `viewer-assets.json`** for the file names instead of hardcoding
  them: `script` (the renderer), `parser` (only needed to call `parse()`
  in the browser, loaded before `script`), `mermaid` (only needed on pages
  with diagrams), `stylesheet`, and `codeThemes.light` / `codeThemes.dark`.
- **API:** `MarkdownViewer.parse(raw, { ticketLinks })` returns HTML
  (also works under Node), with Jira ticket keys like `FLYW-123` linked to
  the ticket (`ticketLinks: { baseUrl, prefixes }` to customize, `null` to
  disable); `MarkdownViewer.enhance(article, { dark, storageKey })` adds
  collapsible sections, clickable task-list checkboxes with per-item
  comments, and diagrams. Checkbox state and comments are saved in
  `localStorage` (comments under `<storageKey>:comments`), one entry per
  page path by default; pass `storageKey` to choose your own key (e.g. per document in a
  hash-routed SPA) or `null` to turn saving off.
