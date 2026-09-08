const ESC = "\x1b[";
const VERSION = "0.4.1";
const TERMINAL_RESET = `${ESC}0m`;
const BLACK_BACKGROUND = `${ESC}48;2;0;0;0m`;
const RESET = `${TERMINAL_RESET}${BLACK_BACKGROUND}`;
const CYAN = `${ESC}38;2;0;255;204m`;
const MAGENTA = `${ESC}38;2;190;110;255m`;
const PALE = `${ESC}38;2;184;230;218m`;
const DIM = `${ESC}2;38;2;100;150;145m`;
const REVERSE = `${ESC}7m`;
const UNREVERSE = `${ESC}27m`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface NeuroConfig {
  kokoroUrl?: string;
  voice?: string;
  speed?: number;
}

interface SpeechTimestamp {
  word: string;
  start_time: number;
  end_time: number;
}

interface SpeechSpan {
  textStart: number;
  textEnd: number;
  line: number;
  visibleStart: number;
}

interface SpeechChunk {
  text: string;
  spans: SpeechSpan[];
}

interface SpeechCue {
  word: string;
  start: number;
  end: number;
  line: number;
  columnStart: number;
  columnEnd: number;
}

interface KokoroSetupModal {
  status: "offline" | "installing" | "ready" | "error";
  detail: string;
  returnScroll: number;
  progress: number;
  stage: string;
  activity: number;
  log: string[];
}

interface EngineExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  render_markdown(pointer: number, length: number, width: number): void;
  result_pointer(): number;
  result_length(): number;
}

function usage(): never {
  console.log(
    `NeuroMD ${VERSION} — a small Rust-powered terminal Markdown viewer

Usage:
  neuromd [--kokoro-url URL] [--voice NAME] [--speed RATE] <file.md>

Keys:
  j/↓  k/↑       scroll one line
  PgDn/PgUp      scroll one page
  g/Home  G/End  first/last line
  r              rendered/raw view
  R              reload file
  s              speak / stop from current line
  L              show logo
  ?              help
  q/Ctrl-C       quit`,
  );
  Deno.exit(0);
}

if (Deno.args.includes("--help") || Deno.args.includes("-h")) usage();
if (Deno.args.includes("--version") || Deno.args.includes("-V")) {
  console.log(`NeuroMD ${VERSION}`);
  Deno.exit(0);
}

let requestedPath: string | undefined;
let requestedKokoroUrl: string | undefined;
let requestedVoice: string | undefined;
let requestedSpeed: number | undefined;
for (let index = 0; index < Deno.args.length; index++) {
  const argument = Deno.args[index];
  const nextValue = () => {
    const value = Deno.args[++index];
    if (!value) usage();
    return value;
  };
  if (argument === "--kokoro-url") requestedKokoroUrl = nextValue();
  else if (argument.startsWith("--kokoro-url=")) {
    requestedKokoroUrl = argument.slice("--kokoro-url=".length);
  } else if (argument === "--voice") requestedVoice = nextValue();
  else if (argument.startsWith("--voice=")) {
    requestedVoice = argument.slice("--voice=".length);
  } else if (argument === "--speed") requestedSpeed = Number(nextValue());
  else if (argument.startsWith("--speed=")) {
    requestedSpeed = Number(argument.slice("--speed=".length));
  } else if (!argument.startsWith("-") && requestedPath === undefined) {
    requestedPath = argument;
  }
}
if (requestedPath === undefined) usage();
const filePath: string = requestedPath;

const executableDirectory = Deno.execPath().replace(/[\\/][^\\/]+$/, "");
const executableConfigPath = `${executableDirectory}${
  Deno.build.os === "windows" ? "\\" : "/"
}neuromd.json`;
const sourceConfigUrl = new URL("./neuromd.json", import.meta.url);

async function readLocalConfig(): Promise<NeuroConfig> {
  const candidates: Array<string | URL> = [
    executableConfigPath,
    sourceConfigUrl,
  ];
  for (const configPath of candidates) {
    try {
      const configText = (await Deno.readTextFile(configPath)).replace(
        /^\uFEFF/,
        "",
      );
      return JSON.parse(configText) as NeuroConfig;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.error(`NeuroMD: ignoring invalid config at ${configPath}`);
      }
    }
  }
  return {};
}

const localConfig = await readLocalConfig();
let kokoroUrl = (requestedKokoroUrl ?? localConfig.kokoroUrl ??
  "http://127.0.0.1:8880").replace(/\/+$/, "");
const kokoroVoice = requestedVoice ?? localConfig.voice ?? "af_bella";
const kokoroSpeed = requestedSpeed ?? localConfig.speed ?? 1;
if (!Number.isFinite(kokoroSpeed) || kokoroSpeed < 0.25 || kokoroSpeed > 4) {
  console.error("NeuroMD: --speed must be between 0.25 and 4");
  Deno.exit(2);
}

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
    const rawColumns = Math.max(24, size.columns);
    return {
      // Some embedded terminals oscillate by one reported column as their
      // scrollbar appears. An even render width absorbs that layout jitter.
      columns: rawColumns - (rawColumns % 2),
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

function centeredField(text: string, width: number): string {
  const remaining = Math.max(0, width - [...text].length);
  const left = Math.floor(remaining / 2);
  return `${" ".repeat(left)}${text}${" ".repeat(remaining - left)}`;
}

function framedRule(text: string, width: number): string {
  const label = ` ${text} `;
  const ruleWidth = Math.max(0, width - [...label].length);
  const left = Math.floor(ruleWidth / 2);
  return `╭${"─".repeat(left)}${label}${"─".repeat(ruleWidth - left)}╮`;
}

function logoLines(width: number): string[] {
  const label = width >= 72 ? "NEUROMD" : width >= 32 ? "NMD" : "N";
  const frameWidth = Math.min(61, Math.max(22, width - 2));
  const brand = width >= 52 ? "N E U R O M D" : "N M D";
  const descriptor = width >= 42
    ? "NEURAL MARKDOWN TERMINAL"
    : "MARKDOWN TERMINAL";
  const lines: string[] = [
    `${DIM}${centered(framedRule(brand, frameWidth), width)}${RESET}`,
    `${CYAN}${
      centered(`│${centeredField(descriptor, frameWidth)}│`, width)
    }${RESET}`,
    `${DIM}${centered(`╰${"─".repeat(frameWidth)}╯`, width)}${RESET}`,
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
      centered(`╶───────────[ READ // ONLY · v${VERSION} ]───────────╴`, width)
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
let speechController: AbortController | undefined;
let speechTask: Promise<void> | undefined;
let speechPlayer: Deno.ChildProcess | undefined;
let speechHighlight: SpeechCue | undefined;
let captionApiAvailable: boolean | undefined;
let kokoroSetup: KokoroSetupModal | undefined;
let kokoroSetupTask: Promise<void> | undefined;
let kokoroSetupDrawTimer: ReturnType<typeof setTimeout> | undefined;

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_PREFIX_PATTERN = new RegExp(
  `^${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`,
);

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function highlightAnsiLine(line: string, start: number, end: number): string {
  let cursor = 0;
  let visible = 0;
  let highlighted = false;
  let output = "";
  while (cursor < line.length) {
    if (line[cursor] === "\x1b") {
      const sequence = line.slice(cursor).match(ANSI_PREFIX_PATTERN)?.[0];
      if (sequence) {
        output += sequence;
        cursor += sequence.length;
        continue;
      }
    }
    if (!highlighted && visible === start) {
      output += REVERSE;
      highlighted = true;
    }
    if (highlighted && visible === end) {
      output += UNREVERSE;
      highlighted = false;
    }
    const character = String.fromCodePoint(line.codePointAt(cursor) ?? 0);
    output += character;
    cursor += character.length;
    visible += character.length;
  }
  if (highlighted) output += UNREVERSE;
  return output;
}

function speechLine(
  line: string,
): { text: string; visibleStart: number } | undefined {
  const visible = stripAnsi(line);
  const prefixLength = visible.match(/^\s*(?:(?:██|▓|•)\s*)?/)?.[0].length ?? 0;
  const text = visible.slice(prefixLength).trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return undefined;
  return { text, visibleStart: visible.indexOf(text, prefixLength) };
}

function buildSpeechChunks(fromLine: number): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  let text = "";
  let spans: SpeechSpan[] = [];
  const flush = () => {
    if (text) chunks.push({ text, spans });
    text = "";
    spans = [];
  };

  for (let line = fromLine; line < renderedLines.length; line++) {
    const spoken = speechLine(renderedLines[line]);
    if (!spoken) continue;
    const separator = text ? "\n" : "";
    if (text && text.length + separator.length + spoken.text.length > 700) {
      flush();
    }
    if (text) text += "\n";
    const textStart = text.length;
    text += spoken.text;
    spans.push({
      textStart,
      textEnd: text.length,
      line,
      visibleStart: spoken.visibleStart,
    });
  }
  flush();
  return chunks;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function repairWavHeader(audio: Uint8Array): Uint8Array {
  if (
    audio.length < 44 || decoder.decode(audio.subarray(0, 4)) !== "RIFF" ||
    decoder.decode(audio.subarray(8, 12)) !== "WAVE"
  ) return audio;
  const repaired = audio.slice();
  const view = new DataView(
    repaired.buffer,
    repaired.byteOffset,
    repaired.byteLength,
  );
  view.setUint32(4, repaired.length - 8, true);
  let offset = 12;
  while (offset + 8 <= repaired.length) {
    const chunkName = decoder.decode(repaired.subarray(offset, offset + 4));
    const declaredSize = view.getUint32(offset + 4, true);
    if (chunkName === "data") {
      view.setUint32(offset + 4, repaired.length - offset - 8, true);
      break;
    }
    if (declaredSize === 0xffffffff) break;
    offset += 8 + declaredSize + (declaredSize % 2);
  }
  return repaired;
}

function wavDuration(audio: Uint8Array): number {
  if (audio.length < 44) return 0;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const byteRate = view.getUint32(28, true);
  return byteRate ? Math.max(0, audio.length - 44) / byteRate : 0;
}

function estimatedTimestamps(
  text: string,
  duration: number,
): SpeechTimestamp[] {
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  if (!words.length) return [];
  const weights = words.map((match) => Math.max(1, Math.sqrt(match[0].length)));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let elapsed = 0;
  return words.map((match, index) => {
    const start = elapsed;
    elapsed += duration * (weights[index] / totalWeight);
    return { word: match[0], start_time: start, end_time: elapsed };
  });
}

function speechCues(
  chunk: SpeechChunk,
  timestamps: SpeechTimestamp[],
): SpeechCue[] {
  const cues: SpeechCue[] = [];
  const lowerText = chunk.text.toLocaleLowerCase();
  const fallbackWord = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  let searchFrom = 0;

  for (const timestamp of timestamps) {
    const word = timestamp.word.replace(
      /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,
      "",
    );
    if (!word) continue;
    let matchStart = lowerText.indexOf(word.toLocaleLowerCase(), searchFrom);
    let matchEnd = matchStart < 0 ? -1 : matchStart + word.length;
    if (matchStart < 0) {
      fallbackWord.lastIndex = searchFrom;
      const fallback = fallbackWord.exec(chunk.text);
      if (!fallback || fallback.index === undefined) continue;
      matchStart = fallback.index;
      matchEnd = matchStart + fallback[0].length;
    }
    searchFrom = matchEnd;
    const span = chunk.spans.find((candidate) =>
      matchStart >= candidate.textStart && matchStart < candidate.textEnd
    );
    if (!span || matchEnd > span.textEnd) continue;
    cues.push({
      word,
      start: timestamp.start_time,
      end: timestamp.end_time,
      line: span.line,
      columnStart: span.visibleStart + matchStart - span.textStart,
      columnEnd: span.visibleStart + matchEnd - span.textStart,
    });
  }
  return cues;
}

async function kokoroIsReachable(
  endpoint = kokoroUrl,
  timeoutMs = 3000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/openapi.json`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function openKokoroSetup(detail: string): void {
  if (kokoroSetup) {
    kokoroSetup.status = "offline";
    kokoroSetup.detail = detail;
    kokoroSetup.progress = 0;
    kokoroSetup.stage = "Endpoint check";
    kokoroSetup.log = [];
    return;
  }
  kokoroSetup = {
    status: "offline",
    detail,
    returnScroll: scroll,
    progress: 0,
    stage: "Endpoint check",
    activity: 0,
    log: [],
  };
  scroll = 0;
}

function closeKokoroSetup(): void {
  if (!kokoroSetup) return;
  scroll = kokoroSetup.returnScroll;
  kokoroSetup = undefined;
}

function requestKokoroSetupDraw(): void {
  if (kokoroSetupDrawTimer !== undefined) return;
  kokoroSetupDrawTimer = setTimeout(() => {
    kokoroSetupDrawTimer = undefined;
    if (running) void queueDraw();
  }, 100);
}

function cleanSetupLine(line: string): string {
  // deno-lint-ignore no-control-regex -- ANSI CSI starts with ESC.
  return line.replace(new RegExp("\\x1b\\[[0-?]*[ -/]*[@-~]", "g"), "")
    // deno-lint-ignore no-control-regex -- remove terminal control bytes.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function acceptSetupLine(rawLine: string, isError: boolean): void {
  if (!kokoroSetup) return;
  const line = cleanSetupLine(rawLine);
  if (!line) return;
  const progress = /^NEUROMD_PROGRESS\|(\d{1,3})\|(.*)$/.exec(line);
  if (progress) {
    kokoroSetup.progress = Math.max(0, Math.min(100, Number(progress[1])));
    kokoroSetup.stage = progress[2].trim() || "Working";
    kokoroSetup.detail = kokoroSetup.stage;
  } else if (!line.startsWith("NEUROMD_SETUP:")) {
    const displayLine = isError ? `! ${line}` : line;
    if (kokoroSetup.log.at(-1) !== displayLine) {
      kokoroSetup.log.push(displayLine);
      kokoroSetup.log = kokoroSetup.log.slice(-4);
    }
  }
  lastMessage = `KOKORO · ${kokoroSetup.stage.toLocaleUpperCase()}`;
  requestKokoroSetupDraw();
}

async function consumeSetupStream(
  stream: ReadableStream<Uint8Array>,
  isError: boolean,
): Promise<void> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split(/\r\n|[\r\n]/);
      pending = lines.pop() ?? "";
      for (const line of lines) acceptSetupLine(line, isError);
    }
    if (pending) acceptSetupLine(pending, isError);
  } finally {
    reader.releaseLock();
  }
}

function installLocalKokoro(): void {
  if (kokoroSetupTask || !kokoroSetup) return;
  kokoroSetup.status = "installing";
  kokoroSetup.detail =
    "Installing under LocalAppData. The first download may take several minutes.";
  kokoroSetup.progress = 1;
  kokoroSetup.stage = "Preparing local installation";
  kokoroSetup.activity = 0;
  kokoroSetup.log = [];
  lastMessage = "KOKORO · LOCAL INSTALL IN PROGRESS";
  void queueDraw();

  const installerPath = `${executableDirectory}\\Install-NeuroMD-Kokoro.ps1`;
  const task = (async () => {
    const activityTimer = setInterval(() => {
      if (kokoroSetup?.status !== "installing") return;
      kokoroSetup.activity = (kokoroSetup.activity + 1) % 8;
      requestKokoroSetupDraw();
    }, 180);
    try {
      await Deno.stat(installerPath);
      const child = new Deno.Command("powershell.exe", {
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          installerPath,
          "-AppDirectory",
          executableDirectory,
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const stdoutTask = consumeSetupStream(child.stdout, false);
      const stderrTask = consumeSetupStream(child.stderr, true);
      const status = await child.status;
      await Promise.all([stdoutTask, stderrTask]);
      if (!status.success) {
        const detail = kokoroSetup?.log.slice(-3).join(" · ") ||
          `The setup process exited with code ${status.code}.`;
        throw new Error(detail);
      }
      kokoroUrl = "http://127.0.0.1:8880";
      captionApiAvailable = undefined;
      if (!(await kokoroIsReachable(kokoroUrl, 5000))) {
        throw new Error(
          "Local Kokoro installed but its endpoint is not ready.",
        );
      }
      if (kokoroSetup) {
        kokoroSetup.status = "ready";
        kokoroSetup.progress = 100;
        kokoroSetup.stage = "Local service ready";
        kokoroSetup.detail =
          "Local Kokoro is ready on 127.0.0.1:8880. Press Enter to read.";
      }
      lastMessage = "KOKORO · LOCAL SERVICE READY";
    } catch (error) {
      if (kokoroSetup) {
        kokoroSetup.status = "error";
        kokoroSetup.stage = "Setup failed";
        kokoroSetup.detail = error instanceof Error
          ? error.message
          : String(error);
      }
      lastMessage = "KOKORO · LOCAL INSTALL FAILED";
    } finally {
      clearInterval(activityTimer);
      if (kokoroSetupDrawTimer !== undefined) {
        clearTimeout(kokoroSetupDrawTimer);
        kokoroSetupDrawTimer = undefined;
      }
      kokoroSetupTask = undefined;
      if (running) await queueDraw();
    }
  })();
  kokoroSetupTask = task;
}

async function requestSpeech(
  chunk: SpeechChunk,
  signal: AbortSignal,
): Promise<
  { audio: Uint8Array; timestamps: SpeechTimestamp[]; exact: boolean }
> {
  const body = {
    model: "kokoro",
    input: chunk.text,
    voice: kokoroVoice,
    response_format: "wav",
    speed: kokoroSpeed,
    stream: false,
  };

  if (captionApiAvailable !== false) {
    const response = await fetch(`${kokoroUrl}/dev/captioned_speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, return_timestamps: true }),
      signal,
    });
    if (response.ok) {
      const result = await response.json();
      captionApiAvailable = true;
      return {
        audio: repairWavHeader(decodeBase64(result.audio)),
        timestamps: result.timestamps ?? [],
        exact: true,
      };
    }
    if (response.status !== 404) {
      throw new Error(`captioned speech returned HTTP ${response.status}`);
    }
    captionApiAvailable = false;
  }

  const response = await fetch(`${kokoroUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Kokoro returned HTTP ${response.status}`);
  const audio = repairWavHeader(new Uint8Array(await response.arrayBuffer()));
  return {
    audio,
    timestamps: estimatedTimestamps(chunk.text, wavDuration(audio)),
    exact: false,
  };
}

async function playSpeech(
  audio: Uint8Array,
  cues: SpeechCue[],
  signal: AbortSignal,
): Promise<void> {
  const audioPath = await Deno.makeTempFile({
    prefix: "neuromd-",
    suffix: ".wav",
  });
  try {
    await Deno.writeFile(audioPath, audio);
    const quotedAudioPath = audioPath.replaceAll("'", "''");
    // stdout/stderr are already piped, so the helper creates no separate UI.
    // PowerShell's -WindowStyle Hidden can hide the shared terminal host itself.
    const command = new Deno.Command("powershell.exe", {
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p=New-Object System.Media.SoundPlayer('${quotedAudioPath}');$p.Load();[Console]::Out.WriteLine('READY');$p.PlaySync()`,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const child = command.spawn();
    speechPlayer = child;
    const statusPromise = child.status;
    const stderrPromise = new Response(child.stderr).text();
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    reader.releaseLock();
    if (signal.aborted) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The player may already have exited.
      }
      await statusPromise;
      return;
    }
    if (!ready.value || !decoder.decode(ready.value).includes("READY")) {
      await statusPromise;
      throw new Error("Windows audio player did not start");
    }
    await write(`\x1b]0;NeuroMD — ${fileName}\x07`);

    const started = performance.now();
    let completed = false;
    statusPromise.finally(() => completed = true);
    let activeIndex = -1;
    while (!completed && !signal.aborted) {
      const elapsed = (performance.now() - started) / 1000;
      let index = cues.findIndex((cue) =>
        elapsed >= cue.start && elapsed < cue.end
      );
      if (index < 0) index = cues.findLastIndex((cue) => elapsed >= cue.start);
      if (index >= 0 && index !== activeIndex) {
        activeIndex = index;
        speechHighlight = cues[index];
        const height = contentHeight();
        if (
          speechHighlight.line < scroll ||
          speechHighlight.line >= scroll + height
        ) {
          scroll = Math.max(0, speechHighlight.line - Math.floor(height / 3));
        }
        await queueDraw();
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (signal.aborted && !completed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The player may already have exited.
      }
    }
    const status = await statusPromise;
    const playerError = (await stderrPromise).trim();
    if (!signal.aborted && !status.success) {
      throw new Error(playerError || "Windows audio playback failed");
    }
  } finally {
    speechPlayer = undefined;
    await Deno.remove(audioPath).catch(() => {});
  }
}

async function narrate(fromLine: number, signal: AbortSignal): Promise<void> {
  const chunks = buildSpeechChunks(fromLine);
  if (!chunks.length) throw new Error("no readable text after this line");
  for (let index = 0; index < chunks.length && !signal.aborted; index++) {
    lastMessage = `KOKORO · GENERATING ${
      index + 1
    }/${chunks.length} · ${kokoroVoice}`;
    await queueDraw();
    const speech = await requestSpeech(chunks[index], signal);
    if (signal.aborted) return;
    const cues = speechCues(chunks[index], speech.timestamps);
    lastMessage = `KOKORO · ${
      speech.exact ? "EXACT" : "ESTIMATED"
    } WORD TIMING · s TO STOP`;
    await playSpeech(speech.audio, cues, signal);
  }
}

function stopNarration(message = "KOKORO · STOPPED"): void {
  speechController?.abort();
  try {
    speechPlayer?.kill("SIGTERM");
  } catch {
    // The player may already have exited.
  }
  speechHighlight = undefined;
  lastMessage = message;
}

async function toggleNarration(skipProbe = false): Promise<void> {
  if (speechTask) {
    stopNarration();
    return;
  }
  if (!skipProbe) {
    lastMessage = `KOKORO · CHECKING ${kokoroUrl}`;
    await queueDraw();
    if (!(await kokoroIsReachable())) {
      openKokoroSetup(`No response from ${kokoroUrl}`);
      lastMessage = "KOKORO · ENDPOINT OFFLINE";
      await queueDraw();
      return;
    }
  }
  showHelp = false;
  showLogo = false;
  raw = false;
  const controller = new AbortController();
  speechController = controller;
  const task = narrate(scroll, controller.signal)
    .catch(async (error) => {
      if (!controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : String(error);
        if (!(await kokoroIsReachable())) {
          openKokoroSetup(detail);
          lastMessage = "KOKORO · ENDPOINT WENT OFFLINE";
        } else {
          lastMessage = `KOKORO FAILED · ${detail}`;
        }
      }
    })
    .finally(async () => {
      if (speechTask === task) speechTask = undefined;
      if (speechController === controller) speechController = undefined;
      speechHighlight = undefined;
      if (
        !controller.signal.aborted && !kokoroSetup &&
        !lastMessage.startsWith("KOKORO FAILED")
      ) {
        lastMessage = "KOKORO · COMPLETE";
      }
      if (running) await queueDraw();
    });
  speechTask = task;
}

function contentHeight(): number {
  return Math.max(1, size.rows - 2);
}

function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function setupProgressText(innerWidth: number): string {
  if (!kokoroSetup) return "";
  const barWidth = Math.max(8, Math.min(46, innerWidth - 14));
  const progress = Math.max(0, Math.min(100, kokoroSetup.progress));
  const filled = Math.floor((progress / 100) * barWidth);
  const cells: string[] = Array.from(
    { length: barWidth },
    (_, index) => index < filled ? "━" : "·",
  );
  if (progress < 100 && filled < barWidth) {
    const remaining = barWidth - filled;
    cells[filled + (kokoroSetup.activity % remaining)] = "◆";
  }
  return `  [${cells.join("")}] ${String(progress).padStart(3)}%`;
}

function kokoroSetupLines(width: number): string[] {
  if (!kokoroSetup) return [];
  const innerWidth = Math.max(28, Math.min(70, width - 6));
  const indent = " ".repeat(
    Math.max(0, Math.floor((width - innerWidth - 2) / 2)),
  );
  const border = "─".repeat(innerWidth);
  const row = (text = "", style = PALE) => {
    const clipped = clipPlain(text, innerWidth);
    return `${indent}${DIM}│${RESET}${style}${clipped}${
      " ".repeat(Math.max(0, innerWidth - clipped.length))
    }${RESET}${DIM}│${RESET}`;
  };
  const status = kokoroSetup.status === "installing"
    ? "INSTALLING LOCAL KOKORO"
    : kokoroSetup.status === "ready"
    ? "LOCAL KOKORO READY"
    : kokoroSetup.status === "error"
    ? "LOCAL SETUP FAILED"
    : "KOKORO ENDPOINT OFFLINE";
  const detail = wrapWords(kokoroSetup.detail, innerWidth - 4);
  const rows = [
    `${indent}${DIM}╭${border}╮${RESET}`,
    row(`  ${status}`, kokoroSetup.status === "error" ? MAGENTA : CYAN),
    row(),
  ];
  if (kokoroSetup.status === "installing") {
    rows.push(
      ...wrapWords(kokoroSetup.stage, innerWidth - 4).map((line) =>
        row(`  ${line}`, PALE)
      ),
      row(setupProgressText(innerWidth), CYAN),
      row(),
      ...kokoroSetup.log.slice(-3).map((line) => row(`  › ${line}`, DIM)),
      row(),
      row("  Keep this window open; no administrator access is used.", DIM),
    );
  } else if (kokoroSetup.status === "ready") {
    rows.push(
      ...detail.map((line) => row(`  ${line}`)),
      row(),
      row("  [ ENTER ]  START READING", CYAN),
      row("  [ ESC   ]  CLOSE", DIM),
    );
  } else {
    rows.push(
      ...detail.map((line) => row(`  ${line}`)),
      row(),
      row("  [ I ]  INSTALL / START LOCAL KOKORO", CYAN),
      row("  [ R ]  RETRY CONFIGURED ENDPOINT", PALE),
      row("  [ ESC ]  CONTINUE WITHOUT SPEECH", DIM),
      row(),
      row("  Downloads: Astral uv, Python, Kokoro and model data.", DIM),
      row("  Source: github.com/remsky/Kokoro-FastAPI", DIM),
    );
  }
  rows.push(`${indent}${DIM}╰${border}╯${RESET}`);
  return ["", "", ...rows];
}

function activeLines(): string[] {
  if (kokoroSetup) return kokoroSetupLines(size.columns);
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
      `${CYAN}s${RESET}            speak / stop from current line`,
      `${CYAN}L${RESET}            show / hide logo`,
      `${CYAN}?${RESET}            close this help`,
      `${CYAN}q / Ctrl-C${RESET}   terminate`,
      "",
      `${DIM}If Kokoro is offline, s opens the local voice setup panel.${RESET}`,
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

function refreshTerminalSize(nextSize = terminalSize()): boolean {
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
  const displayMode = kokoroSetup
    ? "KOKORO SETUP"
    : showLogo
    ? "IDENT"
    : speechTask
    ? "SPEAKING"
    : mode;
  const progress = lines.length <= height
    ? "ALL"
    : `${Math.min(lines.length, scroll + 1)}-${
      Math.min(lines.length, scroll + height)
    }/${lines.length}`;
  const modeText = ` ${displayMode}  ${progress} `;
  const titlePrefix = ` NEURO-MD v${VERSION}  `;
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
    const lineIndex = scroll + row;
    let line = lines[lineIndex] ?? "";
    if (
      !raw && !showHelp && !showLogo && speechHighlight?.line === lineIndex
    ) {
      line = highlightAnsiLine(
        line,
        speechHighlight.columnStart,
        speechHighlight.columnEnd,
      );
    }
    frame += `${ESC}${row + 2};1H${ESC}2K${line}${RESET}`;
  }
  frame += `${ESC}${size.rows};1H${ESC}2K${DIM} ${
    clipPlain(lastMessage, size.columns - 2)
  }${RESET}${ESC}?7h`;
  await write(frame);
}

let drawQueue = Promise.resolve();

function queueDraw(): Promise<void> {
  drawQueue = drawQueue.then(draw, draw);
  return drawQueue;
}

async function watchTerminalSize(): Promise<void> {
  let candidate: { columns: number; rows: number } | undefined;
  let stableSamples = 0;

  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!running) break;

    const observed = terminalSize();
    if (observed.columns === size.columns && observed.rows === size.rows) {
      candidate = undefined;
      stableSamples = 0;
      continue;
    }

    if (
      candidate?.columns === observed.columns &&
      candidate.rows === observed.rows
    ) {
      stableSamples += 1;
    } else {
      candidate = observed;
      stableSamples = 1;
    }

    // Redraw once the dock has reported the same geometry for ~360 ms.
    if (stableSamples >= 3 && refreshTerminalSize(observed)) {
      if (speechTask) stopNarration("KOKORO · STOPPED AFTER RESIZE");
      candidate = undefined;
      stableSamples = 0;
      await queueDraw();
    }
  }
}

async function reload(): Promise<void> {
  if (speechTask) stopNarration("KOKORO · STOPPED FOR RELOAD");
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

async function drawBootLogo(): Promise<void> {
  const screenLines = [
    ...logoLines(size.columns),
    `${DIM}${centered("PRESS ENTER TO OPEN", size.columns)}${RESET}`,
  ];
  const top = Math.max(1, Math.floor((size.rows - screenLines.length) / 2) + 1);

  // A splash can remain open while an embedded terminal is being docked. Use
  // absolute rows and disable auto-wrap so its old geometry is never reflowed.
  let frame = `${RESET}${ESC}?7l${ESC}2J`;
  for (let index = 0; index < screenLines.length; index++) {
    const row = top + index;
    if (row > size.rows) break;
    frame += `${ESC}${row};1H${ESC}2K${screenLines[index]}${RESET}`;
  }
  frame += `${ESC}?7h`;
  await write(frame);
}

async function showBootLogo(): Promise<boolean> {
  let booting = true;
  let candidate: { columns: number; rows: number } | undefined;
  let stableSamples = 0;
  let bootDrawQueue = Promise.resolve();
  const queueBootDraw = () => {
    bootDrawQueue = bootDrawQueue.then(drawBootLogo, drawBootLogo);
    return bootDrawQueue;
  };

  await queueBootDraw();
  const resizeWatcher = (async () => {
    while (booting) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (!booting) break;

      const observed = terminalSize();
      if (observed.columns === size.columns && observed.rows === size.rows) {
        candidate = undefined;
        stableSamples = 0;
        continue;
      }

      if (
        candidate?.columns === observed.columns &&
        candidate.rows === observed.rows
      ) {
        stableSamples += 1;
      } else {
        candidate = observed;
        stableSamples = 1;
      }

      if (stableSamples >= 3 && refreshTerminalSize(observed)) {
        candidate = undefined;
        stableSamples = 0;
        await queueBootDraw();
      }
    }
  })();

  let proceed = false;
  const key = new Uint8Array(16);
  try {
    while (true) {
      const count = await Deno.stdin.read(key);
      if (count === null) break;
      const data = decoder.decode(key.subarray(0, count));
      if (data.includes("\r") || data.includes("\n")) {
        proceed = true;
        break;
      }
      if (data.includes("\x03")) break;
    }
  } finally {
    booting = false;
    await resizeWatcher;
    await bootDrawQueue;
  }
  return proceed;
}

async function clearScreenBlack(): Promise<void> {
  await write(`${RESET}${ESC}2J${ESC}H`);
}

function keyIncludes(data: string, ...keys: string[]): boolean {
  return keys.some((key) => data.includes(key));
}

async function handleInput(data: string): Promise<void> {
  const height = contentHeight();
  if (kokoroSetup) {
    if (kokoroSetup.status === "installing") {
      if (keyIncludes(data, "q", "\x03", "\x1b")) {
        kokoroSetup.detail =
          "Installation is still running. Keep NeuroMD open until it finishes.";
        lastMessage = "KOKORO · INSTALL STILL RUNNING";
      }
      return;
    }
    if (data.includes("\x1b")) {
      closeKokoroSetup();
      lastMessage = "KOKORO · SETUP CLOSED";
      return;
    }
    if (data.toLowerCase() === "i") {
      installLocalKokoro();
      return;
    }
    if (data.toLowerCase() === "r") {
      kokoroSetup.detail = `Checking ${kokoroUrl}`;
      lastMessage = "KOKORO · CHECKING ENDPOINT";
      await queueDraw();
      if (await kokoroIsReachable()) {
        closeKokoroSetup();
        lastMessage = "KOKORO · ENDPOINT READY";
        await toggleNarration(true);
      } else if (kokoroSetup) {
        kokoroSetup.status = "offline";
        kokoroSetup.detail = `Still no response from ${kokoroUrl}`;
        lastMessage = "KOKORO · ENDPOINT OFFLINE";
      }
      return;
    }
    if (
      kokoroSetup.status === "ready" &&
      (data.includes("\r") || data.includes("\n"))
    ) {
      closeKokoroSetup();
      await toggleNarration(true);
    }
    return;
  }
  if (keyIncludes(data, "q", "\x03")) {
    stopNarration("KOKORO · STOPPED");
    running = false;
    return;
  }
  if (data === "?") {
    if (speechTask) stopNarration();
    showHelp = !showHelp;
    showLogo = false;
    scroll = 0;
  } else if (data === "L") {
    if (speechTask) stopNarration();
    showLogo = !showLogo;
    showHelp = false;
    scroll = 0;
  } else if (data === "r") {
    if (speechTask) stopNarration();
    raw = !raw;
    showHelp = false;
    showLogo = false;
    scroll = 0;
    lastMessage = raw ? "SOURCE VIEW" : "RENDERED VIEW";
  } else if (data === "R") {
    await reload();
  } else if (data === "s") {
    await toggleNarration();
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
    `\x1b]0;NeuroMD — ${fileName}\x07${ESC}?1049h${ESC}?25l${BLACK_BACKGROUND}${ESC}2J`,
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
      if (running) await queueDraw();
    }
    await resizeWatcher;
  }
} finally {
  stopNarration();
  if (speechTask) await speechTask;
  Deno.stdin.setRaw(false);
  await write(`${TERMINAL_RESET}${ESC}?7h${ESC}?25h${ESC}?1049l`);
}
