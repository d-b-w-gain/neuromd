const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const CYAN = `${ESC}38;2;0;255;204m`;
const MAGENTA = `${ESC}38;2;190;110;255m`;
const PALE = `${ESC}38;2;184;230;218m`;
const DIM = `${ESC}2;38;2;100;150;145m`;
const REVERSE = `${ESC}7m`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface EngineExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  render_markdown(pointer: number, length: number, width: number): void;
  result_pointer(): number;
  result_length(): number;
}

function usage(): never {
  console.log(`NeuroMD 0.1.0 — a small Rust-powered terminal Markdown viewer

Usage:
  neuromd <file.md>
  deno run --allow-read neuromd.ts <file.md>

Keys:
  j/↓  k/↑       scroll one line
  PgDn/PgUp      scroll one page
  g/Home  G/End  first/last line
  r              rendered/raw view
  R              reload file
  L              show logo
  ?              help
  q/Ctrl-C       quit`);
  Deno.exit(0);
}

if (Deno.args.includes("--help") || Deno.args.includes("-h")) usage();
if (Deno.args.includes("--version") || Deno.args.includes("-V")) {
  console.log("NeuroMD 0.1.0");
  Deno.exit(0);
}

const selectedPath = Deno.args.find((arg) => !arg.startsWith("-"));
if (selectedPath === undefined) usage();
const filePath: string = selectedPath;

const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath;
const wasmUrl = new URL("./neuromd_engine.wasm", import.meta.url);

let source = "";
try {
  source = await Deno.readTextFile(filePath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`NeuroMD: cannot open ${filePath}\n${message}`);
  Deno.exit(1);
}

let wasmBytes: Uint8Array;
try {
  wasmBytes = await Deno.readFile(wasmUrl);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`NeuroMD: cannot load ${wasmUrl.pathname}\n${message}`);
  Deno.exit(1);
}

const wasmBuffer = wasmBytes.slice().buffer as ArrayBuffer;
const wasmModule = await WebAssembly.compile(wasmBuffer);
const instance = await WebAssembly.instantiate(wasmModule, {});
const engine = instance.exports as EngineExports;

function renderMarkdown(markdown: string, width: number): string[] {
  const input = encoder.encode(markdown);
  const pointer = engine.alloc(input.length);
  new Uint8Array(engine.memory.buffer, pointer, input.length).set(input);
  engine.render_markdown(pointer, input.length, width);
  engine.dealloc(pointer, input.length);

  const resultPointer = engine.result_pointer();
  const resultLength = engine.result_length();
  const output = new Uint8Array(
    engine.memory.buffer,
    resultPointer,
    resultLength,
  ).slice();
  return decoder.decode(output).split("\n");
}

function terminalSize(): { columns: number; rows: number } {
  try {
    const size = Deno.consoleSize();
    return {
      columns: Math.max(24, size.columns),
      rows: Math.max(8, size.rows),
    };
  } catch {
    return { columns: 80, rows: 24 };
  }
}

const LOGO_FONT: Record<string, string[]> = {
  "N": [
    "╷     ╷",
    "│╲    │",
    "│ ╲   │",
    "│  ╲  │",
    "│   ╲ │",
    "│    ╲│",
    "╵     ╵",
  ],
  "E": [
    "┌──────",
    "│      ",
    "│      ",
    "├────╴ ",
    "│      ",
    "│      ",
    "└──────",
  ],
  "U": [
    "╷     ╷",
    "│     │",
    "│     │",
    "│     │",
    "│     │",
    "│     │",
    "╰─────╯",
  ],
  "R": [
    "┌─────╮",
    "│     │",
    "│     │",
    "├─────╯",
    "│  ╲   ",
    "│   ╲  ",
    "╵    ╲ ",
  ],
  "O": [
    "╭─────╮",
    "│     │",
    "│     │",
    "│     │",
    "│     │",
    "│     │",
    "╰─────╯",
  ],
  "M": [
    "╷     ╷",
    "│╲   ╱│",
    "│ ╲ ╱ │",
    "│  ╳  │",
    "│     │",
    "│     │",
    "╵     ╵",
  ],
  "D": [
    "┌─────╮",
    "│     │",
    "│     │",
    "│     │",
    "│     │",
    "│     │",
    "└─────╯",
  ],
};

const LOGO_COLORS = [
  "\x1b[1;38;2;0;255;170m",
  "\x1b[1;38;2;0;255;195m",
  "\x1b[1;38;2;0;245;215m",
  "\x1b[1;38;2;20;225;235m",
  "\x1b[1;38;2;55;210;255m",
  "\x1b[1;38;2;105;225;220m",
  "\x1b[1;38;2;175;255;120m",
];

function centered(text: string, width: number): string {
  const left = Math.max(0, Math.floor((width - [...text].length) / 2));
  return `${" ".repeat(left)}${text}`;
}

function logoLines(width: number): string[] {
  const label = width >= 72 ? "NEUROMD" : "NMD";
  const lines: string[] = [
    `${DIM}${
      centered("╭─────────────── N E U R O M D ───────────────╮", width)
    }${RESET}`,
    `${CYAN}${
      centered("╰─╮       NEURAL MARKDOWN TERMINAL       ╭─╯", width)
    }${RESET}`,
  ];

  for (let row = 0; row < 7; row++) {
    const wordmark = [...label].map((letter) => LOGO_FONT[letter][row]).join(
      "  ",
    );
    lines.push(`${LOGO_COLORS[row]}${centered(wordmark, width)}${RESET}`);
  }

  lines.push(
    `${DIM}${centered("╰╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴ ╴╯", width)}${RESET}`,
    "",
    `${PALE}${
      centered("◆  RUST CORE  ──  WASM SIGNAL  ──  DENO SHELL  ◆", width)
    }${RESET}`,
    `${DIM}${
      centered("╶──────────────[ READ // ONLY ]──────────────╴", width)
    }${RESET}`,
    "",
    `${MAGENTA}${
      centered("◁━━━━━━━━━━━━━━━━ SIGNAL ACQUIRED ━━━━━━━━━━━━━━━━▷", width)
    }${RESET}`,
  );
  return lines;
}

function clipPlain(text: string, width: number): string {
  return [...text].slice(0, Math.max(0, width)).join("");
}

function rawLines(markdown: string, width: number): string[] {
  const numberWidth = String(markdown.split("\n").length).length;
  return markdown.split("\n").map((line, index) => {
    const number = String(index + 1).padStart(numberWidth, " ");
    return `${DIM}${number} │${RESET} ${PALE}${
      clipPlain(line, width - numberWidth - 4)
    }${RESET}`;
  });
}

let size = terminalSize();
let renderedLines = renderMarkdown(source, size.columns);
let scroll = 0;
let raw = false;
let showHelp = false;
let showLogo = false;
let running = true;
let lastMessage = "READ ONLY · RUST/WASM · DENO SANDBOX";

function contentHeight(): number {
  return Math.max(1, size.rows - 2);
}

function activeLines(): string[] {
  if (showLogo) return logoLines(size.columns);
  if (showHelp) {
    return [
      `${CYAN}NEUROMD KEY MATRIX${RESET}`,
      "",
      `${CYAN}j / ↓${RESET}        next line`,
      `${CYAN}k / ↑${RESET}        previous line`,
      `${CYAN}PgDn / Space${RESET} next page`,
      `${CYAN}PgUp${RESET}         previous page`,
      `${CYAN}g / Home${RESET}     top`,
      `${CYAN}G / End${RESET}      bottom`,
      `${CYAN}r${RESET}            rendered / source`,
      `${CYAN}R${RESET}            reload from disk`,
      `${CYAN}L${RESET}            show / hide logo`,
      `${CYAN}?${RESET}            close this help`,
      `${CYAN}q / Ctrl-C${RESET}   terminate`,
      "",
      `${DIM}No write, network, subprocess, or FFI access.${RESET}`,
    ];
  }
  return raw ? rawLines(source, size.columns) : renderedLines;
}

function clampScroll(lines = activeLines()): void {
  scroll = Math.max(
    0,
    Math.min(scroll, Math.max(0, lines.length - contentHeight())),
  );
}

function refreshTerminalSize(): boolean {
  const nextSize = terminalSize();
  if (nextSize.columns === size.columns && nextSize.rows === size.rows) {
    return false;
  }

  const widthChanged = nextSize.columns !== size.columns;
  size = nextSize;
  if (widthChanged) renderedLines = renderMarkdown(source, size.columns);
  clampScroll();
  return true;
}

async function write(text: string): Promise<void> {
  const bytes = encoder.encode(text);
  let offset = 0;
  while (offset < bytes.length) {
    const written = await Deno.stdout.write(bytes.subarray(offset));
    if (written === 0) {
      throw new Error("terminal output stopped accepting data");
    }
    offset += written;
  }
}

async function draw(): Promise<void> {
  const lines = activeLines();
  clampScroll(lines);
  const height = contentHeight();
  const mode = showHelp ? "HELP" : raw ? "SOURCE" : "RENDERED";
  const displayMode = showLogo ? "IDENT" : mode;
  const progress = lines.length <= height
    ? "ALL"
    : `${Math.min(lines.length, scroll + 1)}-${
      Math.min(lines.length, scroll + height)
    }/${lines.length}`;
  const modeText = ` ${displayMode}  ${progress} `;
  const titlePrefix = " NEURO-MD  ";
  const fileNameWidth = Math.max(
    1,
    size.columns - titlePrefix.length - modeText.length - 2,
  );
  const titleText = `${titlePrefix}${clipPlain(fileName, fileNameWidth)} `;
  const titleGap = Math.max(
    1,
    size.columns - titleText.length - modeText.length,
  );

  // Address rows directly and suspend terminal auto-wrap for the frame. A line
  // reaching the right edge must never advance the real terminal viewport.
  let frame = `${ESC}?7l${ESC}1;1H${ESC}2K${REVERSE}${CYAN}${titleText}${
    " ".repeat(titleGap)
  }${modeText}${RESET}`;
  for (let row = 0; row < height; row++) {
    frame += `${ESC}${row + 2};1H${ESC}2K${lines[scroll + row] ?? ""}${RESET}`;
  }
  frame +=
    `${ESC}${size.rows};1H${ESC}2K${DIM} ${lastMessage}${RESET}${ESC}?7h`;
  await write(frame);
}

let drawQueue = Promise.resolve();

function queueDraw(): Promise<void> {
  drawQueue = drawQueue.then(draw, draw);
  return drawQueue;
}

async function watchTerminalSize(): Promise<void> {
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (running && refreshTerminalSize()) await queueDraw();
  }
}

async function reload(): Promise<void> {
  try {
    source = await Deno.readTextFile(filePath);
    renderedLines = renderMarkdown(source, size.columns);
    clampScroll();
    lastMessage = "RELOADED";
  } catch (error) {
    lastMessage = `RELOAD FAILED: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function showBootLogo(): Promise<boolean> {
  const logo = logoLines(size.columns);
  const topPadding = Math.max(0, Math.floor((size.rows - logo.length) / 2));
  let frame = `${ESC}H${ESC}2J${"\r\n".repeat(topPadding)}`;
  frame += logo.map((line) => `${ESC}2K${line}`).join("\r\n");
  frame += `\r\n${ESC}2K${DIM}${
    centered("PRESS ENTER TO OPEN", size.columns)
  }${RESET}`;
  await write(frame);

  const key = new Uint8Array(16);
  while (true) {
    const count = await Deno.stdin.read(key);
    if (count === null) return false;
    const data = decoder.decode(key.subarray(0, count));
    if (data.includes("\r") || data.includes("\n")) return true;
    if (data.includes("\x03")) return false;
  }
}

async function clearScreenBlack(): Promise<void> {
  await write(`${RESET}${ESC}48;2;0;0;0m${ESC}2J${ESC}H`);
}

function keyIncludes(data: string, ...keys: string[]): boolean {
  return keys.some((key) => data.includes(key));
}

async function handleInput(data: string): Promise<void> {
  const height = contentHeight();
  if (keyIncludes(data, "q", "\x03")) {
    running = false;
    return;
  }
  if (data === "?") {
    showHelp = !showHelp;
    showLogo = false;
    scroll = 0;
  } else if (data === "L") {
    showLogo = !showLogo;
    showHelp = false;
    scroll = 0;
  } else if (data === "r") {
    raw = !raw;
    showHelp = false;
    showLogo = false;
    scroll = 0;
    lastMessage = raw ? "SOURCE VIEW" : "RENDERED VIEW";
  } else if (data === "R") {
    await reload();
  } else if (keyIncludes(data, "\x1b[6~", " ")) {
    scroll += height;
  } else if (data.includes("\x1b[5~")) {
    scroll -= height;
  } else if (keyIncludes(data, "\x1b[B", "j")) {
    scroll += 1;
  } else if (keyIncludes(data, "\x1b[A", "k")) {
    scroll -= 1;
  } else if (keyIncludes(data, "\x1b[H", "\x1b[1~") || data === "g") {
    scroll = 0;
  } else if (keyIncludes(data, "\x1b[F", "\x1b[4~") || data === "G") {
    scroll = Number.MAX_SAFE_INTEGER;
  }
  clampScroll();
}

if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
  console.log(renderedLines.join("\n"));
  Deno.exit(0);
}

const input = new Uint8Array(32);
try {
  Deno.stdin.setRaw(true);
  await write(
    `\x1b]0;NeuroMD — ${fileName}\x07${ESC}?1049h${ESC}?25l${ESC}48;2;0;0;0m${ESC}2J`,
  );
  running = await showBootLogo();
  if (running) {
    refreshTerminalSize();
    await clearScreenBlack();
    await queueDraw();

    const resizeWatcher = watchTerminalSize();
    while (running) {
      const count = await Deno.stdin.read(input);
      if (count === null) {
        running = false;
        break;
      }
      await handleInput(decoder.decode(input.subarray(0, count)));
      refreshTerminalSize();
      if (running) await queueDraw();
    }
    await resizeWatcher;
  }
} finally {
  Deno.stdin.setRaw(false);
  await write(`${RESET}${ESC}?7h${ESC}?25h${ESC}?1049l`);
}
