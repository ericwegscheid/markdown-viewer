(() => {
  "use strict";

  // Guard: only act on URLs whose path ends with a markdown extension.
  // (The manifest globs already restrict this, but query strings / edge
  // cases are filtered here too.)
  const path = location.pathname.toLowerCase();
  if (!/\.(md|markdown|mkd|mdown)$/.test(path)) return;

  // Avoid double-processing (e.g. if the script somehow runs twice).
  if (document.documentElement.dataset.markdownViewer === "1") return;

  // Grab the raw markdown. When Chrome displays a text file it wraps the
  // contents in a single <pre>; otherwise fall back to the body text.
  const pre = document.querySelector("body > pre");
  const raw = pre ? pre.textContent : (document.body ? document.body.innerText : "");

  // If there's no meaningful text, leave the page alone.
  if (!raw || !raw.trim()) return;

  document.documentElement.dataset.markdownViewer = "1";

  // Rendering and post-processing live in viewer.js (MarkdownViewer).
  const html = MarkdownViewer.parse(raw);

  // Pick a hljs theme matching the user's color scheme.
  const prefersDark = window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const hljsTheme = prefersDark ? "github-dark.min.css" : "github-light.min.css";

  // Rebuild the document.
  const title = decodeURIComponent(path.split("/").pop());
  document.title = title;

  // Reset head and inject the hljs theme stylesheet.
  document.head.innerHTML = "";
  const meta = document.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  document.head.appendChild(meta);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL(hljsTheme);
  document.head.appendChild(link);

  // Replace body with the rendered markdown inside a styled container,
  // then add collapsible sections, the collapse-all toggle and diagrams.
  document.body.innerHTML = "";
  document.body.classList.add("markdown-viewer-body");
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = html;
  document.body.appendChild(article);
  MarkdownViewer.enhance(article, { dark: prefersDark });
})();
