# Markdown Viewer

A minimal Chrome (Manifest V3) extension that renders `*.md` files as
human-readable, GitHub-styled HTML — both local `file://` files and `.md`
files served over the web.

## What it does

When you open a URL whose path ends in `.md`, `.markdown`, `.mkd`, or
`.mdown`, the extension:

- parses the raw markdown with [marked](https://marked.js.org/) (GitHub-flavored),
- syntax-highlights fenced code blocks with [highlight.js](https://highlightjs.org/),
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
| `content.js` | Reads the raw markdown, renders it, rebuilds the page |
| `markdown.css` | GitHub-like page styling (light + dark) |
| `marked.min.js` | Markdown parser (v4.3.0) |
| `highlight.min.js` | Syntax highlighter (v11.9.0) |
| `github-light.min.css` / `github-dark.min.css` | hljs themes, picked at runtime |

## Notes

- The extension reads the markdown directly from the page Chrome already
  displays, so it works offline and needs no network access.
- Files served as a download (`Content-Disposition: attachment`) or as
  pre-rendered HTML won't be intercepted — it targets raw markdown text.
