import { EditorSelection, EditorState } from "https://esm.sh/@codemirror/state@6";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection
} from "https://esm.sh/@codemirror/view@6";
import {
  defaultKeymap,
  history,
  historyKeymap
} from "https://esm.sh/@codemirror/commands@6";
import {
  bracketMatching,
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
  StreamLanguage
} from "https://esm.sh/@codemirror/language@6";
import { tags as t } from "https://esm.sh/@lezer/highlight@1";

const initialSource = [
  'val greeting = "hello from VibeClown"',
  "print greeting",
  "",
  "val numbers = [1, 2, 3, 4]",
  "val line = collect numbers",
  "    map item -> item * 2",
  '    join by ", "',
  'print "doubled: ${line}"'
].join("\n");

const editorHost = document.getElementById("sourceEditor");
const runButton = document.getElementById("runButton");
const clearButton = document.getElementById("clearButton");
const statusText = document.getElementById("statusText");
const sourceStats = document.getElementById("sourceStats");
const terminalOutput = document.getElementById("terminalOutput");
const jsOutput = document.getElementById("jsOutput");
const terminalTab = document.getElementById("terminalTab");
const jsTab = document.getElementById("jsTab");
const runnerFrame = document.getElementById("runnerFrame");

let compiledJs = "";
let runId = 0;
let runnerReadyResolve = null;
let runnerReadyPromise = Promise.resolve();
let lastOcelogTime = "";
const pendingRuns = new Map();
const blockIndent = "    ";

const keywords = new Set([
  "after",
  "as",
  "box",
  "break",
  "catch",
  "collect",
  "continue",
  "else",
  "every",
  "false",
  "flow",
  "fn",
  "for",
  "from",
  "if",
  "in",
  "live",
  "match",
  "not",
  "null",
  "permission",
  "permissions",
  "return",
  "then",
  "true",
  "try",
  "use",
  "val",
  "var",
  "while"
]);

const builtins = new Set([
  "debug",
  "from_json",
  "http",
  "log",
  "panic",
  "print",
  "socket",
  "spy",
  "wait",
  "ws"
]);

const permissionEntries = new Set([
  "extern",
  "inject",
  "net",
  "opfs",
  "storage"
]);

const vibeclownLanguage = StreamLanguage.define({
  name: "vibeclown",
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.match(/"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/\b\d+(?:\.\d+)?(?:ms|s|mb|kb|gb)?\b/i)) return "number";
    if (stream.match(/~~\s*(?:warn(?:ing)?\b)?[^\n]*/)) return "meta";
    if (stream.match(/->|=>|==|!=|<=|>=|\.\.|[+\-*/%=<>!|&]+/)) return "operator";
    if (stream.match(/[()[\]{}.,:]/)) return "punctuation";

    const word = stream.match(/[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const value = word[0];
      if (keywords.has(value)) return "keyword";
      if (permissionEntries.has(value)) return "atom";
      if (builtins.has(value)) return "builtin";
      if (/^[A-Z]/.test(value)) return "type";
      return "variable";
    }

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "//" }
  }
});

const vibeclownHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#6750a4", fontWeight: "700" },
  { tag: t.string, color: "#286a43" },
  { tag: t.number, color: "#8f4a00" },
  { tag: t.atom, color: "#005ac1", fontWeight: "650" },
  { tag: t.meta, color: "#8c4b00", fontStyle: "italic" },
  { tag: t.comment, color: "#79747e", fontStyle: "italic" },
  { tag: t.operator, color: "#625b71" },
  { tag: t.punctuation, color: "#5f5a66" },
  { tag: t.typeName, color: "#386a1f", fontWeight: "650" },
  { tag: t.variableName, color: "#1c1b1f" },
  { tag: t.standard(t.variableName), color: "#006a6a", fontWeight: "650" }
]);

function getSource() {
  return editorView.state.doc.toString();
}

function now() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatLevel(kind) {
  if (!kind) return "      ";

  const levelText = `[${kind}]`;
  return levelText.length < 6 ? levelText.padEnd(6, " ") : `${levelText} `;
}

function appendLine(text, kind, options = {}) {
  const timeText = now();
  const continuation = Boolean(options.continuation);
  const showTime = !continuation && timeText !== lastOcelogTime;
  if (showTime) lastOcelogTime = timeText;

  const line = document.createElement("div");
  line.className = "ocelog-line";

  const timestamp = document.createElement("span");
  timestamp.className = "ocelog-time";
  timestamp.textContent = showTime ? timeText : "";

  const separator = document.createElement("span");
  separator.className = "ocelog-separator";
  separator.textContent = "  ";

  const level = document.createElement("span");
  level.className = "ocelog-level";
  level.textContent = continuation ? "" : formatLevel(kind);

  const message = document.createElement("span");
  message.className = "ocelog-message";
  message.textContent = text;

  line.append(timestamp, separator, level, message);
  terminalOutput.append(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function appendBlock(text, kind) {
  const lines = String(text || "").replace(/\s+$/u, "").split("\n");
  if (lines.length === 0 || lines[0] === "") return;

  appendLine(lines[0], kind);
  for (const line of lines.slice(1)) {
    appendLine(line, null, { continuation: true });
  }
}

function formatDiagnosticCliLike(diagnostic, filename = "main.clown") {
  const severity = diagnostic.severity || "error";
  const line = Math.max(1, Number(diagnostic.line || 1));
  const column = Math.max(1, Number(diagnostic.column || 1));
  const sourceLine = diagnostic.source_line || "";
  const sourceLines = [
    ...(diagnostic.context?.before || []),
    { line, text: sourceLine },
    ...(diagnostic.context?.after || [])
  ];
  const lineNumberWidth = Math.max(3, ...sourceLines.map((item) => String(item.line || "").length));
  const gutter = `${" ".repeat(lineNumberWidth)} |`;
  const caretPadding = " ".repeat(column - 1);
  const output = [
    `${severity}: ${diagnostic.message || String(diagnostic)}`,
    `  --> ${filename}:${line}:${column}`,
    ` ${gutter}`
  ];

  for (const item of sourceLines) {
    output.push(`${String(item.line).padStart(lineNumberWidth, " ")} | ${item.text || ""}`);
    if (item.line === line) {
      output.push(` ${gutter} ${caretPadding}^`);
    }
  }

  if (diagnostic.hint) {
    output.push(`   = help: ${diagnostic.hint}`);
  }

  return output.join("\n");
}

function setActiveTab(next) {
  const showJs = next === "js";
  terminalTab.classList.toggle("active", !showJs);
  jsTab.classList.toggle("active", showJs);
  terminalTab.setAttribute("aria-selected", String(!showJs));
  jsTab.setAttribute("aria-selected", String(showJs));
  terminalOutput.classList.toggle("active", !showJs);
  jsOutput.classList.toggle("active", showJs);
}

function updateStats() {
  const lines = editorView.state.doc.lines;
  sourceStats.textContent = `${lines} line${lines === 1 ? "" : "s"}`;
  updateLineNumberGutterWidth(lines);
}

function updateLineNumberGutterWidth(lines) {
  const digits = String(Math.max(1, lines)).length;
  const width = 28 + Math.max(0, digits - 1) * 8;
  editorHost.style.setProperty("--line-number-gutter-width", `${width}px`);
}

function updateCompilerStatus() {
  if (window.Vibe && window.Vibe.ready && window.Vibe.ready()) {
      const version = window.Vibe.version ? window.Vibe.version() : "ready";
      statusText.textContent = `Compiler ${version} alpha`;
      runButton.disabled = false;
      return;
  }

  statusText.textContent = "Loading compiler...";
  runButton.disabled = true;
}

function shouldIncreaseIndent(text) {
  const trimmed = text.trim();
  if (!trimmed || /^(return|break|continue)\b/.test(trimmed)) return false;

  return (
    /^(fn|flow|if|else|for|while|match|try|catch|box|permission|permissions)\b/.test(trimmed) ||
    /\bcollect\b/.test(trimmed) ||
    /\b(on|every|after)\b/.test(trimmed)
  );
}

function autoIndentAfterEnter(state, pos) {
  const line = state.doc.lineAt(pos);
  const beforeCursor = line.text.slice(0, pos - line.from);
  const baseIndent = beforeCursor.match(/^\s*/)[0];
  return shouldIncreaseIndent(beforeCursor) ? baseIndent + blockIndent : baseIndent;
}

function insertNewlineWithVibeIndent(view) {
  view.dispatch(view.state.changeByRange((range) => {
    const indent = autoIndentAfterEnter(view.state, range.from);
    return {
      changes: { from: range.from, to: range.to, insert: `\n${indent}` },
      range: EditorSelection.cursor(range.from + 1 + indent.length)
    };
  }), { scrollIntoView: true, userEvent: "input" });
  return true;
}

function deleteIndentChunk(view) {
  const range = view.state.selection.main;
  if (!range.empty) return false;

  const line = view.state.doc.lineAt(range.from);
  const offset = range.from - line.from;
  const beforeCursor = line.text.slice(0, offset);
  if (!/^\s+$/.test(beforeCursor) || beforeCursor.length < blockIndent.length) return false;

  const deleteCount = Math.min(blockIndent.length, beforeCursor.length);
  view.dispatch({
    changes: { from: range.from - deleteCount, to: range.from },
    selection: { anchor: range.from - deleteCount },
    scrollIntoView: true,
    userEvent: "delete.backward"
  });
  return true;
}

function insertIndentSpaces(view) {
  view.dispatch(view.state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: blockIndent },
    range: EditorSelection.cursor(range.from + blockIndent.length)
  })), { scrollIntoView: true, userEvent: "input" });
  return true;
}

function makeSandboxHtml() {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><title>runner</title></head>',
    "<body>",
    "<script>",
    "const send = (type, payload, id) => parent.postMessage({ source: 'vibe-runner', type, payload, id }, '*');",
    "['log', 'info', 'warn', 'error'].forEach((level) => {",
    "  const original = console[level].bind(console);",
    "  console[level] = (...args) => {",
    "    original(...args);",
    "    send('console', { level, args: args.map((item) => {",
    "      try { return typeof item === 'string' ? item : JSON.stringify(item); }",
    "      catch (_) { return String(item); }",
    "    }) });",
    "  };",
    "});",
    "window.addEventListener('message', async (event) => {",
    "  const data = event.data || {};",
    "  if (data.source !== 'vibe-parent' || data.type !== 'run') return;",
    "  try {",
    "    await new Function(data.code)();",
    "    send('done', null, data.id);",
    "  } catch (error) {",
    "    send('error', { message: error && error.message ? error.message : String(error) }, data.id);",
    "  }",
    "});",
    "send('ready');",
    "<\/script>",
    "</body></html>"
  ].join("");
}

function resetSandbox() {
  runnerReadyPromise = new Promise((resolve) => {
    runnerReadyResolve = resolve;
  });
  runnerFrame.srcdoc = makeSandboxHtml();
  return runnerReadyPromise;
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

async function executeInSandbox(code) {
  await withTimeout(
    runnerReadyPromise,
    4000,
    "sandbox runner did not become ready"
  );

  return withTimeout(new Promise((resolve, reject) => {
    const id = ++runId;
    pendingRuns.set(id, { resolve, reject });
    runnerFrame.contentWindow.postMessage({
      source: "vibe-parent",
      type: "run",
      id,
      code
    }, "*");
  }), 8000, "sandbox run timed out");
}

function handleRunnerMessage(event) {
  const data = event.data || {};
  if (data.source !== "vibe-runner") return;

  if (data.type === "ready") {
    if (runnerReadyResolve) runnerReadyResolve();
    runnerReadyResolve = null;
    return;
  }

  if (data.type === "console") {
    const payload = data.payload || {};
    const text = (payload.args || []).join(" ");
    appendLine(text, payload.level || "log");
    return;
  }

  if (data.type === "error") {
    const pending = pendingRuns.get(data.id);
    if (!pending) return;
    pendingRuns.delete(data.id);
    pending.reject(new Error(data.payload && data.payload.message ? data.payload.message : "Runtime error"));
    return;
  }

  if (data.type === "done") {
    const pending = pendingRuns.get(data.id);
    if (!pending) return;
    pendingRuns.delete(data.id);
    pending.resolve();
  }
}

async function runSource() {
  if (!window.Vibe || !window.Vibe.ready || !window.Vibe.ready()) {
    appendLine("compiler is not ready yet", "warn");
    return;
  }

  setActiveTab("terminal");
  runButton.disabled = true;
  statusText.textContent = "Running...";
  compiledJs = "";
  jsOutput.textContent = "";
  resetSandbox();

  try {
    const source = getSource();
    const result = window.Vibe.compile(source);
      if (!result.success) {
        appendLine("compile failed", "error");
        for (const error of result.errors || []) {
          appendBlock(formatDiagnosticCliLike(error), error.severity || "error");
        }
        jsOutput.textContent = "";
        return;
      }

      const warnings = result.warnings || [];
      for (const warning of warnings) appendBlock(formatDiagnosticCliLike(warning), "warn");
    compiledJs = result.code || "";
    jsOutput.textContent = compiledJs || "// compiler returned empty JavaScript";
    appendLine("compiled successfully", "ok");

    window.VibeExecuteJs = async (code) => {
      compiledJs = code;
      jsOutput.textContent = code;
      await executeInSandbox(code);
    };

    await window.Vibe.run(source, "playground/main.clown");
    appendLine("run completed", "ok");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    appendLine(message, "error");
  } finally {
    delete window.VibeExecuteJs;
    runButton.disabled = false;
    updateCompilerStatus();
  }
}

const editorView = new EditorView({
  parent: editorHost,
  state: EditorState.create({
    doc: initialSource,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      highlightActiveLine(),
      bracketMatching(),
      vibeclownLanguage,
      syntaxHighlighting(vibeclownHighlight),
      indentUnit.of(blockIndent),
      keymap.of([
        { key: "Enter", run: insertNewlineWithVibeIndent },
        { key: "Backspace", run: deleteIndentChunk },
        { key: "Tab", run: insertIndentSpaces },
        { key: "Mod-Enter", run: () => { runSource(); return true; } },
        ...historyKeymap,
        ...defaultKeymap
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) updateStats();
      }),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          height: "100%"
        },
        ".cm-content": {
          tabSize: "4"
        }
      })
    ]
  })
});

window.VibePrint = (text) => appendLine(text, "print");
window.VibeError = (error) => appendLine(error.message || String(error), "error");
window.addEventListener("vibeready", updateCompilerStatus);
window.addEventListener("message", handleRunnerMessage);

runButton.addEventListener("click", runSource);
clearButton.addEventListener("click", () => {
  terminalOutput.textContent = "";
  lastOcelogTime = "";
});
terminalTab.addEventListener("click", () => setActiveTab("terminal"));
jsTab.addEventListener("click", () => setActiveTab("js"));
document.addEventListener("pointerdown", (event) => {
  if (window.VibeClownRipple) {
    window.VibeClownRipple.handleDelegatedRipple(event);
  }
});

resetSandbox();
updateStats();
updateCompilerStatus();
