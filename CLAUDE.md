# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Manifest V3 extension with no build step and no dependencies to
install — everything needed to load it is already checked into the repo.
There is no test suite, linter, or bundler; verification is done by loading
the extension unpacked in Chrome and opening a `.md` file.

## Development / testing

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this folder.
2. Enable **Allow access to file URLs** on the extension's Details page to
   test local `file://*.md` files.
3. After editing any file, click the reload icon for the extension on
   `chrome://extensions`, then reload the target `.md` page to pick up
   changes (content scripts are not hot-reloaded).
4. Test both a local file (`file:///path/to/file.md`) and a remote raw
   `.md` URL, and toggle OS light/dark mode, since rendering branches on
   `prefers-color-scheme`.

## Architecture

All logic lives in `content.js`, a single IIFE injected as a content script
matching `*.md`/`.markdown`/`.mkd`/`.mdown` URLs (declared in
`manifest.json`). It runs once per page load, in this sequence:

1. **Guard** — re-checks the URL extension and a
   `document.documentElement.dataset.markdownViewer` flag so it never
   double-processes a page.
2. **Extract raw markdown** — Chrome wraps plaintext file views in a single
   `body > pre`; the script reads `.textContent` from that (falling back to
   `body.innerText`). This means the extension depends on Chrome's own
   plaintext rendering of the file and only works on *raw* markdown text —
   pre-rendered HTML or files served as a download
   (`Content-Disposition: attachment`) are never intercepted.
3. **Parse + highlight** — `marked` (GFM mode) converts markdown to HTML;
   its `highlight()` callback delegates fenced code blocks to `hljs`.
4. **Post-process** — `wrapH2Sections()` groups each `<h2>` and its
   following siblings into a `<section class="md-h2-section">` (content
   before the first `<h2>` is left alone), and
   `makeH2SectionsCollapsible()` wires a click handler on each `<h2>` to
   toggle a `.collapsed` class on its section — this is what
   `markdown.css` uses to hide/show section bodies.
5. **Rebuild the document** — `<head>` is cleared and repopulated with a
   charset meta tag and a `<link>` to whichever hljs theme
   (`github-dark.min.css` / `github-light.min.css`) matches
   `prefers-color-scheme`; `<body>` is cleared and replaced with a single
   `article.markdown-body` containing the rendered HTML. In-page anchor
   navigation (`location.hash`) is re-applied manually afterward since the
   DOM it pointed at no longer exists.

Third-party libraries (`marked.min.js`, `highlight.min.js`, the
`github-*.min.css` hljs themes) are vendored, minified files — treat them
as opaque; update by replacing them with a newer minified build rather than
hand-editing. `markdown.css` is the only stylesheet meant to be edited
directly; it owns both the GitHub-like page theme (light + dark, keyed off
`prefers-color-scheme`) and the collapsible-section styling
(`.md-h2-section`, `.md-h2-toggle`, `.collapsed`).

The two hljs theme CSS files are listed as `web_accessible_resources`
(rather than injected via the manifest's `content_scripts.css`) because
`content.js` picks one of the two at runtime via `chrome.runtime.getURL()`.
