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

The logic is split across two files, both injected as content scripts
matching `*.md`/`.markdown`/`.mkd`/`.mdown` URLs (declared in
`manifest.json`):

- `viewer.js` — the reusable renderer, exposed as a `MarkdownViewer`
  global (or `module.exports` under Node). `MarkdownViewer.parse(raw)`
  covers step 3 and needs only `marked` + `hljs`, so it also runs at build
  time in Node; `MarkdownViewer.enhance(article, { dark, storageKey, taskUrl, taskSource })` covers steps 4
  and 6 plus the hash scroll, and needs a DOM with the article attached.
  It has no extension-specific code (no `chrome.*`, no URL checks), so
  other projects can consume it — e.g. the `hal-9000` repo's GitLab Pages
  build clones this repo and pre-renders its docs with `parse()`, then
  calls `enhance()` in the browser. Keep that API stable.
  Consumers find the files to load via `viewer-assets.json` (renderer
  script, parser scripts, mermaid, stylesheet, light/dark hljs themes)
  rather than hardcoding names — update it whenever one of those files is
  renamed or added. Consumers pin release tags (`vX.Y.Z`, matching
  `manifest.json`'s `version`), so breaking changes to the API or that
  file need a major version bump.
- `content.js` — the extension glue: a single IIFE that runs once per page
  load and calls into `viewer.js`, in this sequence:

1. **Guard** — re-checks the URL extension and a
   `document.documentElement.dataset.markdownViewer` flag so it never
   double-processes a page.
2. **Extract raw markdown** — Chrome wraps plaintext file views in a single
   `body > pre`; the script reads `.textContent` from that (falling back to
   `body.innerText`). This means the extension depends on Chrome's own
   plaintext rendering of the file and only works on *raw* markdown text —
   pre-rendered HTML or files served as a download
   (`Content-Disposition: attachment`) are never intercepted.
3. **Parse + highlight** (`parse()`) — `marked` (GFM mode) converts markdown to HTML;
   its `highlight()` callback delegates fenced code blocks to `hljs`
   (except `mermaid` blocks, which are passed through as escaped text).
   Between lexing and rendering, `linkTickets()` turns Jira keys
   (`FLYW-123`, `PLT-…`, etc. — see `DEFAULT_TICKET_LINKS`) in plain inline
   text into `a.md-ticket-link` links to the ticket (opening in a new tab); code, existing links
   and raw `<a>` contents are skipped. `parse(raw, { ticketLinks })`
   overrides the base URL/prefixes, or `null` disables it.
4. **Post-process** (`enhance()`, after step 5) — `wrapH2Sections()` groups each `<h2>` and its
   following siblings into a `<section class="md-h2-section">` (content
   before the first `<h2>` is left alone), and
   `makeH2SectionsCollapsible()` wires a click handler on each `<h2>` to
   toggle a `.collapsed` class on its section — this is what
   `markdown.css` uses to hide/show section bodies. `addCollapseAllToggle()`
   then adds a fixed top-right
   `button.md-collapse-all` that collapses all sections (or expands them
   all when every one is already collapsed). `makeTaskListsToggleable()`
   replaces marked's disabled task-list checkboxes with clickable
   `button.md-task-check` toggles (styled after work-tab's
   `.mentions-check-btn`) that dim the item's `span.md-task-text` when
   checked (no strikethrough); only the checkbox itself toggles it.
   Toggled state persists in
   `localStorage` (not `chrome.storage`, so it works outside the
   extension) under `enhance()`'s `storageKey` option — by default
   `markdown-viewer:tasks:<pathname>`, i.e. per file; pass a shared string
   for per-domain state or `null` to disable. Only items differing from the
   markdown source are stored, keyed by item text (plus `#n` for
   duplicates). Clicking a task item's text (outside links) shows/hides a
   `textarea.md-task-comment` below that line (`addTaskComment()`);
   non-blank comments are stored the same way under
   `<storageKey>:comments`. A `button.md-task-comment-icon` just left of
   the checkbox, always shown, toggles the same textarea (`aria-expanded`)
   and turns blue instead of gray while the item has a comment
   (`.has-comment`). Each item gets an anchor id (`taskAnchor()`:
   `task-<slug of its text>`, `-2`… for repeats), and a
   `button.md-task-copy` left of the comment button (`addTaskCopy()`)
   copies a ready-to-paste AI prompt (`taskPrompt()`) built from the
   document title, `taskSource`, the item's link (`taskUrl(id)`, default
   page URL + `#id`), its heading path, status, text and comment. Lists
   holding task items (`.md-task-list`) get 22px of extra indent for the
   second gutter button.
5. **Rebuild the document** — `<head>` is cleared and repopulated with a
   charset meta tag and a `<link>` to whichever hljs theme
   (`github-dark.min.css` / `github-light.min.css`) matches
   `prefers-color-scheme`; `<body>` is cleared and replaced with a single
   `article.markdown-body` containing the rendered HTML. In-page anchor
   navigation (`location.hash`) is re-applied manually afterward since the
   DOM it pointed at no longer exists.
6. **Render diagrams** (`enhance()`) — `renderMermaid()` replaces each
   `pre > code.language-mermaid` with a `div.mermaid` and calls
   `mermaid.run()` using mermaid's `base` theme, with `themeVariables`
   built by `mermaidThemeVariables()` from the `--md-*` tokens in
   `markdown.css` (read via `getComputedStyle`, so they follow
   `prefers-color-scheme`).
   This runs after the article is attached so mermaid can measure text,
   and the hash scroll is re-applied once rendering settles.

Third-party libraries `marked.min.js`, `highlight.min.js`, and
`mermaid.min.js` (the UMD build from `mermaid/dist/`) are vendored,
minified files — treat them as opaque; update by replacing them with a
newer minified build rather than hand-editing.

`markdown.css` and the two `github-*.min.css` files are hand-maintained,
not vendored: both are a custom color theme sourced from
`colors.css` in the sibling `work-tab` project
(`~/git/github.com/ericwegscheid/work-tab/common/css/base/colors.css`),
not GitHub's actual colors despite the filenames. `colors.css` keeps its
accent hues (red/green/blue/magenta/cyan/yellow) identical across light
and dark and only flips backgrounds/borders/text per theme — both files
here follow that same split (see the `--md-*` custom properties at the
top of `markdown.css` for the token-to-source mapping). `markdown.css`
owns the page theme and the collapsible-section styling
(`.md-h2-section`, `.md-h2-toggle`, `.collapsed`); the `github-*.min.css`
files own hljs code-block syntax token colors. `markdown.css` also
defines `--md-accent-*` tokens that no CSS rule uses — they exist only as
the palette source for mermaid diagrams. Keep both in sync with
`colors.css` if that palette changes, and keep the `github-*.min.css`
filenames as-is since `manifest.json` and `content.js` reference them
directly.

The two hljs theme CSS files are listed as `web_accessible_resources`
(rather than injected via the manifest's `content_scripts.css`) because
`content.js` picks one of the two at runtime via `chrome.runtime.getURL()`.
