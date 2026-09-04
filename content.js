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

  // Configure marked (GitHub-flavored, with syntax highlighting via hljs).
  const renderer = new marked.Renderer();
  marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: true,
    mangle: false,
    highlight(code, lang) {
      try {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        }
        return hljs.highlightAuto(code).value;
      } catch (_) {
        return code;
      }
    },
  });

  const html = marked.parse(raw);

  // Group each <h2> and everything up to the next <h2> into a <section>,
  // so h2-based collapsible sections can be built on top of this structure.
  // Content before the first <h2> is left untouched.
  function wrapH2Sections(container) {
    let section = null;
    for (const node of Array.from(container.children)) {
      if (node.tagName === "H2") {
        section = document.createElement("section");
        section.className = "md-h2-section";
        container.insertBefore(section, node);
        section.appendChild(node);
      } else if (section) {
        section.appendChild(node);
      }
    }
  }

  // Clicking an h2 toggles the "collapsed" class on its enclosing
  // .md-h2-section, hiding everything in that section but the heading.
  function makeH2SectionsCollapsible(container) {
    for (const h2 of container.querySelectorAll(".md-h2-section > h2")) {
      h2.classList.add("md-h2-toggle");
      h2.addEventListener("click", () => {
        h2.parentElement.classList.toggle("collapsed");
      });
    }
  }

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

  // Replace body with the rendered markdown inside a styled container.
  document.body.innerHTML = "";
  document.body.classList.add("markdown-viewer-body");
  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = html;
  wrapH2Sections(article);
  makeH2SectionsCollapsible(article);
  document.body.appendChild(article);

  // Make in-page anchor links work after the rebuild.
  if (location.hash) {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(id);
    if (target) target.scrollIntoView();
  }
})();
