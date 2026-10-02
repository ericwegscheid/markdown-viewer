// Reusable markdown rendering, shared by the extension (content.js) and by
// anything else that wants the same output, e.g. a static site build.
//
//   MarkdownViewer.parse(raw)             -> HTML string (marked + hljs)
//   MarkdownViewer.enhance(article, opts) -> collapsible h2 sections, the
//                                            collapse-all toggle, clickable
//                                            task-list checkboxes/comments and mermaid
//                                            diagrams on an attached article
//
// parse() needs only marked and hljs, so it also runs under Node
// (require("./viewer.js")); enhance() needs a DOM and, for diagrams, mermaid.
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./marked.min.js"), require("./highlight.min.js"));
  } else {
    root.MarkdownViewer = factory(root.marked, root.hljs);
  }
})(typeof self !== "undefined" ? self : this, function (marked, hljs) {
  "use strict";

  // GitHub-flavored markdown, with fenced code highlighted by hljs.
  const markedOptions = {
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
  };

  // Jira ticket keys ("FLYW-123") found in plain text are linked to the
  // ticket. Override per call via parse(raw, { ticketLinks }), or pass
  // ticketLinks: null to turn it off.
  const DEFAULT_TICKET_LINKS = {
    baseUrl: "https://flywheelio.atlassian.net/browse/",
    prefixes: ["FLYW", "PLT", "VDS", "PS", "APPSEC", "FR", "OBJ", "CEN"],
  };

  //   parse(raw)                     -> HTML string
  //   parse(raw, { ticketLinks })    -> same, with custom (or null: no)
  //                                     ticket linking
  function parse(raw, { ticketLinks = DEFAULT_TICKET_LINKS } = {}) {
    if (!ticketLinks) return marked.parse(raw, markedOptions);
    const options = Object.assign({}, marked.defaults, markedOptions);
    const tokens = marked.lexer(raw, options);
    linkTickets(tokens, ticketLinks);
    return marked.parser(tokens, options);
  }

  // Turn ticket keys in inline text tokens into links, in place. Code spans
  // and blocks aren't text tokens, so they're never touched; link labels
  // (markdown links, autolinked URLs) and text inside raw <a>...</a> are
  // skipped so links never nest. Keys must stand alone: "XPS-1" or
  // "FLYW-1a" don't match.
  function linkTickets(tokens, { baseUrl, prefixes }) {
    const pattern = new RegExp(`(?<![\\w-])(?:${prefixes.join("|")})-\\d+(?!\\w)`, "gi");
    let anchorDepth = 0;
    const walk = (list) => {
      for (const token of list) {
        if (token.type === "html") {
          if (/^<a[\s>]/i.test(token.text)) anchorDepth++;
          else if (/^<\/a\s*>/i.test(token.text)) anchorDepth = Math.max(0, anchorDepth - 1);
          continue;
        }
        if (token.type === "link") continue;
        if (token.type === "text" && !token.tokens) {
          // Inline text is already HTML-escaped by marked, and keys are
          // only letters, digits and "-", so they're safe to wrap as-is.
          if (anchorDepth) continue;
          const linked = token.text.replace(
            pattern,
            (key) => `<a class="md-ticket-link" href="${baseUrl}${key.toUpperCase()}">${key}</a>`
          );
          if (linked !== token.text) {
            token.type = "html";
            token.text = linked;
          }
          continue;
        }
        if (token.tokens) walk(token.tokens);
        if (token.items) walk(token.items);
        if (token.header) token.header.forEach((cell) => walk(cell.tokens));
        if (token.rows) token.rows.forEach((row) => row.forEach((cell) => walk(cell.tokens)));
      }
    };
    walk(tokens);
  }

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
      button.textContent = collapsed ? "+ Expand all" : "− Collapse all";
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

  // Replace marked's disabled task-list <input type="checkbox"> with a
  // clickable button.md-task-check (icon-swapping checkbox, same approach as
  // work-tab's .mentions-check-btn), and wrap the item's own text in a
  // span.md-task-text so the checked fade doesn't bleed into nested lists.
  // Only clicking the checkbox toggles it; clicking the text toggles the
  // item's comment (see addTaskComment).
  //
  // Toggled state persists in localStorage under storageKey (null disables
  // it). Only items that differ from the markdown source are stored, keyed
  // by their text plus an occurrence count for duplicates, so editing other
  // lines of the file doesn't shift which items are checked. Each item also
  // gets a comment toggle (see addTaskComment), stored the same way under
  // "<storageKey>:comments", an anchor id derived from the same key (see
  // taskAnchor) and a copy-as-prompt button (see addTaskCopy), which uses
  // links.url(id) / links.source to say where the item lives.
  function makeTaskListsToggleable(container, storageKey, links) {
    const overrides = loadStore(storageKey);
    const commentsKey = storageKey && `${storageKey}:comments`;
    const comments = loadStore(commentsKey);
    const seen = new Map();
    const anchors = new Set();

    const inputs = container.querySelectorAll(
      "li > input[type=checkbox], li > p:first-child > input[type=checkbox]"
    );
    for (const input of inputs) {
      const item = input.closest("li");
      item.classList.add("md-task-item");
      item.parentElement.classList.add("md-task-list");

      const check = document.createElement("button");
      check.type = "button";
      check.className = "md-task-check";
      check.setAttribute("role", "checkbox");
      check.setAttribute("aria-label", "Toggle item");

      // Everything after the checkbox up to the first block element (a
      // nested list, or the next paragraph in a loose list item).
      const text = document.createElement("span");
      text.className = "md-task-text";
      while (input.nextSibling && !/^(UL|OL|P|PRE|BLOCKQUOTE|TABLE|DIV)$/.test(input.nextSibling.nodeName)) {
        text.appendChild(input.nextSibling);
      }

      const label = text.textContent.trim().replace(/\s+/g, " ");
      const count = (seen.get(label) || 0) + 1;
      seen.set(label, count);
      const id = count > 1 ? `${label}#${count}` : label;
      const sourceChecked = input.checked;

      const setChecked = (checked) => {
        item.classList.toggle("checked", checked);
        check.setAttribute("aria-checked", String(checked));
      };
      setChecked(id in overrides ? overrides[id] : sourceChecked);

      const toggle = () => {
        const checked = !item.classList.contains("checked");
        setChecked(checked);
        if (checked === sourceChecked) delete overrides[id];
        else overrides[id] = checked;
        saveStore(storageKey, overrides);
      };
      check.addEventListener("click", toggle);

      if (!item.id) item.id = taskAnchor(label, anchors);

      input.replaceWith(check, text);
      const textarea = addTaskComment(item, text, (value) => {
        if (value.trim()) comments[id] = value;
        else delete comments[id];
        saveStore(commentsKey, comments);
      }, comments[id] || "");
      addTaskCopy(container, item, text, textarea, links);
    }
  }

  // URL-safe, unique anchor id for a task item: "task-" plus its text
  // slugged and cut to about 60 characters at a word break, with "-2", "-3"
  // for repeats. Like the storage keys, it only changes when the item's own
  // text does.
  function taskAnchor(label, taken) {
    let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug.length > 60) slug = slug.slice(0, 60).replace(/-[^-]*$/, "");
    const base = `task-${slug || "item"}`;
    let anchor = base;
    for (let n = 2; taken.has(anchor) || document.getElementById(anchor); n++) anchor = `${base}-${n}`;
    taken.add(anchor);
    return anchor;
  }

  // Clicking a task item's text (outside links), or the comment button just
  // left of the checkbox, shows/hides a textarea right below that line,
  // above any nested list. The button is marked .has-comment (blue) while the
  // textarea holds non-blank text. save(value) is called on every edit.
  // Returns the textarea.
  function addTaskComment(item, text, save, initial) {
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "md-task-comment-icon";
    icon.title = "Comment";
    icon.setAttribute("aria-label", "Toggle comment");
    icon.setAttribute("aria-expanded", "false");

    const textarea = document.createElement("textarea");
    textarea.className = "md-task-comment";
    textarea.rows = 3;
    textarea.placeholder = "Add a comment\u2026";
    textarea.setAttribute("aria-label", "Comment");
    textarea.value = initial;
    textarea.hidden = true;

    const update = () => icon.classList.toggle("has-comment", !!textarea.value.trim());
    update();

    const toggle = () => {
      textarea.hidden = !textarea.hidden;
      icon.setAttribute("aria-expanded", String(!textarea.hidden));
      if (!textarea.hidden) textarea.focus();
    };
    icon.addEventListener("click", toggle);
    text.addEventListener("click", (event) => {
      if (!event.target.closest("a")) toggle();
    });
    textarea.addEventListener("input", () => {
      update();
      save(textarea.value);
    });

    text.previousElementSibling.before(icon);
    // In a loose list item the line is a <p>; the textarea goes after it.
    const line = text.parentElement === item ? text : text.parentElement;
    line.after(textarea);
    return textarea;
  }

  // Button left of the comment button that copies the item, its comment and
  // where it lives to the clipboard as a ready-to-paste AI prompt (see
  // taskPrompt). Marked .copied for a moment once the copy succeeds.
  function addTaskCopy(container, item, text, textarea, links) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-task-copy";
    button.title = "Copy as AI prompt";
    button.setAttribute("aria-label", "Copy item as AI prompt");

    let timer;
    button.addEventListener("click", () => {
      const prompt = taskPrompt({
        title: documentTitle(container),
        url: links.url(item.id),
        source: links.source,
        section: taskSection(container, item),
        item: text.textContent.trim().replace(/\s+/g, " "),
        done: item.classList.contains("checked"),
        comment: textarea.value.trim(),
      });
      copyText(prompt).then(() => {
        button.classList.add("copied");
        clearTimeout(timer);
        timer = setTimeout(() => button.classList.remove("copied"), 1500);
      });
    });

    item.querySelector(".md-task-comment-icon").before(button);
  }

  // The prompt copied by addTaskCopy. Each piece is labeled and the free
  // text is fenced in tags, so the receiving model can tell the item from
  // the reader's comment and knows where to find the full document.
  function taskPrompt({ title, url, source, section, item, done, comment }) {
    const context = [
      `Document: ${title}`,
      source && `Source: ${source}`,
      `Item link: ${url}`,
      section && `Section: ${section}`,
      `Status: ${done ? "checked off" : "open"}`,
    ].filter(Boolean);
    const ask = comment
      ? "Read the document for context first (the item sits under the section named above), then act on my comment about this action item. If my comment asks a question, answer it before changing anything."
      : "Read the document for context first (the item sits under the section named above), then help me complete this action item.";
    return [
      `I'd like your help with an action item from the document "${title}".`,
      "",
      "<context>",
      ...context,
      "</context>",
      "",
      "<action_item>",
      item,
      "</action_item>",
      ...(comment ? ["", "<my_comment>", comment, "</my_comment>"] : []),
      "",
      `${ask} If anything is unclear, ask me before making changes.`,
    ].join("\n");
  }

  // The article's first h1, or the page title.
  function documentTitle(container) {
    const h1 = container.querySelector("h1");
    return ((h1 && h1.textContent) || document.title).trim().replace(/\s+/g, " ");
  }

  // The h2–h6 headings an item sits under, outermost first, e.g.
  // "Stories > FLYW-123".
  function taskSection(container, item) {
    const path = [];
    for (const heading of container.querySelectorAll("h2, h3, h4, h5, h6")) {
      if (!(heading.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      const level = Number(heading.tagName[1]);
      path.length = Math.min(path.length, level - 2);
      path[level - 2] = heading.textContent.trim().replace(/\s+/g, " ");
    }
    return path.filter(Boolean).join(" > ");
  }

  // navigator.clipboard needs a secure context (and, in a frame, the
  // clipboard-write permission); fall back to execCommand where it's missing.
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).catch(() => legacyCopy(value));
    }
    return legacyCopy(value);
  }

  function legacyCopy(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }

  // JSON map in localStorage under key (null/empty disables it). Storage can
  // be missing or throw (private windows, blocked site data, sandboxed
  // iframes); state then just isn't persisted.
  function loadStore(key) {
    if (!key) return {};
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (_) {
      return {};
    }
  }

  function saveStore(key, map) {
    if (!key) return;
    try {
      if (Object.keys(map).length) {
        localStorage.setItem(key, JSON.stringify(map));
      } else {
        localStorage.removeItem(key);
      }
    } catch (_) {
      // Ignore; see loadStore.
    }
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

  function defaultStorageKey() {
    return `markdown-viewer:tasks:${location.pathname}`;
  }

  // This page's URL with "#<id>"; the default for enhance()'s taskUrl.
  function defaultTaskUrl(id) {
    return `${location.href.split("#")[0]}#${id}`;
  }

  // Scroll to location.hash, for pages whose DOM was built after load,
  // expanding its section first if that's collapsed. The target is also
  // marked .md-target, since :target doesn't match ids added after load.
  function scrollToHash() {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    const section = target.closest(".md-h2-section.collapsed");
    if (section && !target.classList.contains("md-h2-toggle")) section.classList.remove("collapsed");
    target.classList.add("md-target");
    target.scrollIntoView();
  }

  // Post-process a rendered article that is already attached to the
  // document. The hash scroll is re-applied once diagrams finish rendering,
  // since they shift the layout. Resolves when diagrams are done.
  //
  // Options:
  //   dark       - use the dark mermaid palette
  //   storageKey - localStorage key for task-list checkbox state (comments
  //                go under "<storageKey>:comments"); defaults to one key
  //                per page path (localStorage itself is already scoped per
  //                origin). Pass a shared string to share state across
  //                pages, or null to disable persistence.
  //   taskUrl    - (anchorId) => link to a task item, put in the prompt its
  //                copy button builds; defaults to this page's URL + "#id".
  //                Pass one when readers reach the page under another URL.
  //   taskSource - optional text naming where the document's source lives
  //                (a repo path, a file URL), added to that prompt.
  function enhance(
    article,
    { dark = false, storageKey = defaultStorageKey(), taskUrl = defaultTaskUrl, taskSource = "" } = {}
  ) {
    wrapH2Sections(article);
    makeH2SectionsCollapsible(article);
    addCollapseAllToggle(article);
    makeTaskListsToggleable(article, storageKey, { url: taskUrl, source: taskSource });
    scrollToHash();
    return renderMermaid(article, dark).then(scrollToHash);
  }

  return { parse, enhance };
});
