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
      // Mermaid source is rendered as a diagram later; returning it
      // unchanged makes marked HTML-escape it as plain text.
      if (lang === "mermaid") return code;
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

  // Fixed top-right button that collapses every .md-h2-section, or expands
  // them all once every section is already collapsed. Its label is kept in
  // sync when individual sections are toggled via their headings.
  function addCollapseAllToggle(container) {
    const sections = container.querySelectorAll(".md-h2-section");
    if (!sections.length) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-collapse-all";

    const allCollapsed = () =>
      Array.from(sections).every((s) => s.classList.contains("collapsed"));
    const update = () => {
      const collapsed = allCollapsed();
      button.textContent = collapsed ? "+ Expand all" : "\u2212 Collapse all";
      button.setAttribute("aria-expanded", String(!collapsed));
    };

    button.addEventListener("click", () => {
      const collapse = !allCollapsed();
      for (const section of sections) section.classList.toggle("collapsed", collapse);
      update();
    });
    // Heading click handlers run first; this bubbles up after them.
    container.addEventListener("click", update);

    update();
    document.body.appendChild(button);
  }

  // Build mermaid's "base" theme from the --md-* palette tokens defined in
  // markdown.css, so diagrams follow the same colors (and light/dark split)
  // as the rest of the page.
  function mermaidThemeVariables(container, dark) {
    const style = getComputedStyle(document.documentElement);
    const token = (name) => style.getPropertyValue(`--md-${name}`).trim();

    // Categorical scale for pie, journey, mindmap, timeline, git graphs.
    const scale = [
      "accent-bright-blue", "accent-bright-cyan", "accent-magenta",
      "accent-yellow", "accent-red", "accent-bright-magenta", "accent-cyan",
      "accent-green", "accent-blue", "accent-bright-yellow", "accent-teal",
      "accent-bright-red",
    ].map(token);

    const vars = {
      darkMode: dark,
      fontFamily: getComputedStyle(container).fontFamily,
      background: token("bg"),
      textColor: token("fg"),
      lineColor: token("muted"),

      // Flowchart / class / state / sequence nodes
      primaryColor: token("code-block-bg"),
      primaryTextColor: token("fg"),
      primaryBorderColor: token("accent-bright-blue"),
      secondaryColor: token("selection"),
      secondaryTextColor: token("fg"),
      secondaryBorderColor: token("accent-cyan"),
      tertiaryColor: token("bg"),
      tertiaryTextColor: token("fg"),
      tertiaryBorderColor: token("border"),
      clusterBkg: token("bg"),
      clusterBorder: token("border"),
      edgeLabelBackground: token("bg"),

      // Notes
      noteBkgColor: token("mark-bg"),
      noteTextColor: token("mark-fg"),
      noteBorderColor: token("accent-yellow"),

      // Gantt
      // Mermaid draws section row bands at opacity 0.2, so these need
      // saturated accents (not surface colors) to be visible.
      sectionBkgColor: token("accent-bright-blue"),
      sectionBkgColor2: token("accent-bright-cyan"),
      altSectionBkgColor: token("muted"),
      gridColor: token("border"),
      taskBkgColor: token("accent-cyan"),
      taskBorderColor: token("accent-bright-blue"),
      taskTextColor: "#f5f6fa",
      taskTextLightColor: "#f5f6fa",
      taskTextDarkColor: token("mark-fg"),
      taskTextOutsideColor: token("fg"),
      taskTextClickableColor: token("link"),
      activeTaskBkgColor: token("accent-bright-cyan"),
      activeTaskBorderColor: token("accent-cyan"),
      doneTaskBkgColor: token("muted"),
      doneTaskBorderColor: token("border"),
      critBkgColor: token("accent-red"),
      critBorderColor: token("accent-bright-red"),
      todayLineColor: token("accent-bright-red"),

      // Errors
      errorBkgColor: token("accent-red"),
      errorTextColor: token("fg"),
    };
    scale.forEach((color, i) => {
      vars[`cScale${i}`] = color;
      vars[`pie${i + 1}`] = color;
    });
    return vars;
  }

  // Swap each ```mermaid code block for a <div class="mermaid"> holding its
  // source, then have mermaid render them all to SVG. Must run after the
  // article is in the document so mermaid can measure text.
  function renderMermaid(container, dark) {
    const blocks = container.querySelectorAll("pre > code.language-mermaid");
    if (!blocks.length || typeof mermaid === "undefined") return Promise.resolve();
    const nodes = [];
    for (const code of blocks) {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
      nodes.push(div);
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: mermaidThemeVariables(container, dark),
    });
    return mermaid.run({ nodes, suppressErrors: true })
      .then(() => nodes.forEach(separateGanttSections))
      .catch(() => {});
  }

  // Gantt charts draw one background band per task row, colored by the
  // task's section (class "section sectionN"). Trim the bands on either side
  // of each section boundary so a gap appears between sections, while rows
  // within a section stay contiguous. Mermaid leaves a few px between each
  // band edge and its task bar, so this doesn't clip the bars.
  function separateGanttSections(node) {
    const GAP = 4;
    const bands = Array.from(
      node.querySelectorAll('svg[aria-roledescription="gantt"] rect.section')
    ).sort((a, b) => a.y.baseVal.value - b.y.baseVal.value);
    for (let i = 1; i < bands.length; i++) {
      const prev = bands[i - 1];
      const band = bands[i];
      if (band.getAttribute("class") === prev.getAttribute("class")) continue;
      prev.height.baseVal.value -= GAP / 2;
      band.y.baseVal.value += GAP / 2;
      band.height.baseVal.value -= GAP / 2;
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
  addCollapseAllToggle(article);

  // Make in-page anchor links work after the rebuild. Re-applied once
  // diagrams finish rendering, since they shift the layout.
  function scrollToHash() {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(id);
    if (target) target.scrollIntoView();
  }
  scrollToHash();
  renderMermaid(article, prefersDark).then(scrollToHash);
})();
