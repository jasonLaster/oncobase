#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { loadConfig } from "./config";
import { readVaultDocuments, type PublishDocument } from "./walk-vault";

const DEFAULT_MODEL = "openai/gpt-realtime-2";
const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_MAX_CONTEXT_CHARS = 120_000;

type CliOptions = {
  site?: string;
  audio?: string;
  title?: string;
  prompt?: string;
  model: string;
  baseUrl: string;
  sessionDir?: string;
  output?: string;
  transcriptOutput?: string;
  noteOutput?: string;
  contextFiles: string[];
  wikiRefs: string[];
  includeWikiIndex: boolean;
  includeWikiAll: boolean;
  includeSensitive: boolean;
  maxContextChars: number;
  transcribe: boolean;
  ffmpegInput?: string;
  ffmpegFormat: "mp3" | "wav";
};

type ContextSection = {
  label: string;
  source: string;
  content: string;
};

function readFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function readFlags(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values.flatMap((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function usage() {
  console.error(`Usage:
  oncobase transcription record --site <slug> [--context <file>] [--wiki <slug-or-path>] [--title <title>]
  oncobase transcription transcribe --site <slug> --audio <file> [--context <file>] [--wiki <slug-or-path>]

Options:
  --context <file>           Extra context file. Repeatable or comma-separated.
  --wiki <slug-or-path>      Include a specific wiki page. Repeatable or comma-separated.
  --wiki-all                 Include wiki page bodies until --max-context-chars is reached.
  --no-wiki-index            Skip the compact wiki title/tag index.
  --include-sensitive        Include locally sensitive wiki pages in wiki context.
  --model <id>               Gateway model id. Default: ${DEFAULT_MODEL}
  --base-url <url>           OpenAI-compatible base URL. Default: ${DEFAULT_GATEWAY_BASE_URL}
  --dir <path>               Session directory root.
  --output <file>            Full model markdown output.
  --transcript-output <file> Transcript markdown output.
  --note-output <file>       Enriched note markdown output.
  --input <ffmpeg-input>     Recording input. macOS default is :0 for the default audio device.
  --format <mp3|wav>         Recording format. Default: mp3.
  --no-transcribe            For record: save audio only.`);
}

function parseOptions(args: string[], subcommand: string): CliOptions {
  const positional = args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = args[index - 1];
    return !previous?.startsWith("--");
  });
  const audio = readFlag(args, "--audio") ?? (subcommand === "transcribe" ? positional[0] : undefined);
  const format = readFlag(args, "--format") ?? "mp3";
  if (format !== "mp3" && format !== "wav") {
    throw new Error("--format must be mp3 or wav.");
  }

  const maxContextChars = Number(readFlag(args, "--max-context-chars") ?? DEFAULT_MAX_CONTEXT_CHARS);
  if (!Number.isFinite(maxContextChars) || maxContextChars < 1) {
    throw new Error("--max-context-chars must be a positive number.");
  }

  return {
    site: readFlag(args, "--site"),
    audio,
    title: readFlag(args, "--title"),
    prompt: readFlag(args, "--prompt"),
    model: readFlag(args, "--model") ?? process.env.ONCOBASE_TRANSCRIPTION_MODEL ?? DEFAULT_MODEL,
    baseUrl:
      readFlag(args, "--base-url") ??
      process.env.AI_GATEWAY_BASE_URL ??
      DEFAULT_GATEWAY_BASE_URL,
    sessionDir: readFlag(args, "--dir"),
    output: readFlag(args, "--output"),
    transcriptOutput: readFlag(args, "--transcript-output"),
    noteOutput: readFlag(args, "--note-output"),
    contextFiles: readFlags(args, "--context"),
    wikiRefs: readFlags(args, "--wiki"),
    includeWikiIndex: !hasFlag(args, "--no-wiki-index"),
    includeWikiAll: hasFlag(args, "--wiki-all"),
    includeSensitive: hasFlag(args, "--include-sensitive"),
    maxContextChars,
    transcribe: !hasFlag(args, "--no-transcribe"),
    ffmpegInput: readFlag(args, "--input"),
    ffmpegFormat: format,
  };
}

function getVaultPath(site?: string) {
  if (!site) return undefined;
  return loadConfig(site).vaultPath;
}

function createSessionDir(options: CliOptions, vaultPath?: string) {
  if (options.output || options.transcriptOutput || options.noteOutput) {
    const firstOutput = options.output ?? options.transcriptOutput ?? options.noteOutput;
    if (firstOutput) {
      fs.mkdirSync(path.dirname(path.resolve(firstOutput)), { recursive: true });
    }
  }
  const root = path.resolve(
    options.sessionDir ??
      path.join(vaultPath ?? process.cwd(), ".oncobase", "transcriptions"),
  );
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const dir = path.join(root, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureReadableFile(filePath: string) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Expected a file: ${resolved}`);
  return resolved;
}

function readTextFile(filePath: string) {
  return fs.readFileSync(ensureReadableFile(filePath), "utf8");
}

function resolveContextFile(filePath: string, vaultPath?: string) {
  const candidates = [
    path.resolve(filePath),
    vaultPath ? path.resolve(vaultPath, filePath) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Context file not found: ${filePath}`);
  return ensureReadableFile(found);
}

function normalizeWikiRef(ref: string) {
  return ref
    .replace(/^\.\//, "")
    .replace(/\.(?:md|mdx)$/i, "")
    .replace(/\\/g, "/");
}

function wikiContext(
  vaultPath: string | undefined,
  options: CliOptions,
): ContextSection[] {
  if (!vaultPath) return [];

  const docs = readVaultDocuments(vaultPath).filter(
    (doc) => options.includeSensitive || !doc.sensitive,
  );
  const sections: ContextSection[] = [];

  if (options.includeWikiIndex) {
    sections.push({
      label: "Wiki page index",
      source: vaultPath,
      content: docs
        .map((doc) => {
          const tags = doc.tags.length ? ` tags=${doc.tags.join(",")}` : "";
          return `- ${doc.title} (${doc.slug})${tags}`;
        })
        .join("\n"),
    });
  }

  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  for (const ref of options.wikiRefs) {
    const normalized = normalizeWikiRef(ref);
    const doc = bySlug.get(normalized);
    if (!doc) {
      throw new Error(`Wiki page not found or excluded: ${ref}`);
    }
    sections.push(wikiDocumentSection(doc));
  }

  if (options.includeWikiAll) {
    for (const doc of docs) sections.push(wikiDocumentSection(doc));
  }

  return sections;
}

function wikiDocumentSection(doc: PublishDocument): ContextSection {
  return {
    label: `Wiki page: ${doc.title}`,
    source: doc.slug,
    content: `# ${doc.title}\n\n${doc.content}`,
  };
}

function collectContext(options: CliOptions, vaultPath?: string) {
  const fileSections = options.contextFiles.map((file) => {
    const resolved = resolveContextFile(file, vaultPath);
    return {
      label: `Context file: ${path.basename(resolved)}`,
      source: resolved,
      content: readTextFile(resolved),
    };
  });
  const sections = [...fileSections, ...wikiContext(vaultPath, options)];
  return trimContext(sections, options.maxContextChars);
}

function trimContext(sections: ContextSection[], maxChars: number) {
  const kept: ContextSection[] = [];
  let remaining = maxChars;
  for (const section of sections) {
    if (remaining <= 0) break;
    const content =
      section.content.length > remaining
        ? `${section.content.slice(0, Math.max(0, remaining - 40))}\n[truncated for context budget]`
        : section.content;
    kept.push({ ...section, content });
    remaining -= content.length;
  }
  return kept;
}

function formatContext(sections: ContextSection[]) {
  if (sections.length === 0) return "No additional context was supplied.";
  return sections
    .map(
      (section) =>
        `## ${section.label}\nSource: ${section.source}\n\n${section.content}`,
    )
    .join("\n\n---\n\n");
}

function ffmpegExists() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function defaultFfmpegInput() {
  if (process.platform === "darwin") return { args: ["-f", "avfoundation", "-i", ":0"], help: "macOS default audio device (:0)" };
  if (process.platform === "linux") return { args: ["-f", "pulse", "-i", "default"], help: "Linux PulseAudio default device" };
  return { args: ["-i", "default"], help: "default audio device" };
}

function recordingArgs(options: CliOptions, audioPath: string) {
  const input = options.ffmpegInput
    ? customFfmpegInput(options.ffmpegInput)
    : defaultFfmpegInput();
  const formatArgs =
    options.ffmpegFormat === "mp3"
      ? ["-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-b:a", "64k"]
      : ["-ac", "1", "-ar", "24000", "-codec:a", "pcm_s16le"];
  return {
    args: ["-y", ...input.args, ...formatArgs, audioPath],
    inputHelp: input.help,
  };
}

function customFfmpegInput(input: string) {
  if (process.platform === "darwin") {
    return { args: ["-f", "avfoundation", "-i", input], help: input };
  }
  if (process.platform === "linux") {
    return { args: ["-f", "pulse", "-i", input], help: input };
  }
  return { args: ["-i", input], help: input };
}

async function recordAudio(options: CliOptions, sessionDir: string) {
  if (!ffmpegExists()) {
    throw new Error("ffmpeg is required for recording. Install ffmpeg or use transcription transcribe --audio <file>.");
  }
  const audioPath = path.join(sessionDir, `recording.${options.ffmpegFormat}`);
  const { args, inputHelp } = recordingArgs(options, audioPath);
  console.log(`Recording ${inputHelp}`);
  console.log("Press Ctrl-C to stop and transcribe.");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.kill("SIGINT");
    };
    process.once("SIGINT", stop);
    child.once("error", (error) => {
      process.off("SIGINT", stop);
      reject(error);
    });
    child.once("close", (code) => {
      process.off("SIGINT", stop);
      if (code === 0 || (stopping && fs.existsSync(audioPath))) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with status ${code ?? "unknown"}.`));
      }
    });
  });

  return audioPath;
}

function audioFormat(filePath: string): "mp3" | "wav" | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3") return "mp3";
  if (ext === ".wav") return "wav";
  return null;
}

function convertAudioForModel(audioPath: string, sessionDir: string) {
  const existingFormat = audioFormat(audioPath);
  if (existingFormat) return { audioPath, format: existingFormat };
  if (!ffmpegExists()) {
    throw new Error(`Audio format is not mp3/wav and ffmpeg is not available for conversion: ${audioPath}`);
  }
  const converted = path.join(sessionDir, `${path.basename(audioPath, path.extname(audioPath))}.mp3`);
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", audioPath, "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-b:a", "64k", converted],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed to convert ${audioPath}`);
  return { audioPath: converted, format: "mp3" as const };
}

function getGatewayClient(baseUrl: string) {
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) {
    throw new Error("Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN to use Vercel AI Gateway.");
  }
  return new OpenAI({ apiKey, baseURL: baseUrl });
}

function buildInstructions(options: CliOptions) {
  const style = options.prompt ?? "Draft a polished markdown note from the recording.";
  return [
    "You are transcribing and drafting notes for an Oncobase wiki operator.",
    "Use the supplied context to resolve names, organizations, trial names, page names, abbreviations, and domain-specific terms.",
    "Prefer exact names and spellings from the context when the audio is ambiguous.",
    "Return markdown with exactly two top-level headings: # Transcript and # Note.",
    "Under # Transcript, write a readable transcript with speaker labels when inferable.",
    "Under # Note, write the enriched note. Preserve uncertainty when the audio is unclear.",
    style,
  ].join("\n");
}

async function transcribeAudio(
  options: CliOptions,
  audioPath: string,
  sessionDir: string,
  contextSections: ContextSection[],
) {
  const preparedAudio = convertAudioForModel(audioPath, sessionDir);
  const audioData = fs.readFileSync(preparedAudio.audioPath).toString("base64");
  const client = getGatewayClient(options.baseUrl);
  const context = formatContext(contextSections);
  const title = options.title ? `Title: ${options.title}\n\n` : "";

  const response = await client.responses.create({
    model: options.model,
    instructions: buildInstructions(options),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${title}Transcribe this recording after the fact and then draft the note.\n\n# Context\n\n${context}`,
          },
          {
            type: "input_audio",
            input_audio: {
              data: audioData,
              format: preparedAudio.format,
            },
          },
        ],
      },
    ],
    max_output_tokens: 32_000,
  } as OpenAI.Responses.ResponseCreateParamsNonStreaming);

  const outputText = response.output_text?.trim();
  if (!outputText) {
    throw new Error("The transcription model returned no text output.");
  }
  return outputText;
}

function splitOutput(markdown: string) {
  const transcriptMatch = markdown.match(/^# Transcript\s*([\s\S]*?)(?=^# Note\s*$)/m);
  const noteMatch = markdown.match(/^# Note\s*([\s\S]*)$/m);
  return {
    transcript: transcriptMatch?.[1]?.trim() ?? "",
    note: noteMatch?.[1]?.trim() ?? "",
  };
}

function writeOutputs(
  options: CliOptions,
  sessionDir: string,
  markdown: string,
  audioPath: string,
  contextSections: ContextSection[],
) {
  const outputPath = path.resolve(options.output ?? path.join(sessionDir, "result.md"));
  const transcriptPath = path.resolve(options.transcriptOutput ?? path.join(sessionDir, "transcript.md"));
  const notePath = path.resolve(options.noteOutput ?? path.join(sessionDir, "note.md"));
  const split = splitOutput(markdown);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.writeFileSync(outputPath, `${markdown}\n`);
  fs.writeFileSync(transcriptPath, `${split.transcript || markdown}\n`);
  fs.writeFileSync(notePath, `${split.note || markdown}\n`);
  fs.writeFileSync(
    path.join(sessionDir, "manifest.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        model: options.model,
        baseUrl: options.baseUrl,
        audioPath,
        outputPath,
        transcriptPath,
        notePath,
        context: contextSections.map(({ label, source, content }) => ({
          label,
          source,
          chars: content.length,
        })),
      },
      null,
      2,
    )}\n`,
  );

  return { outputPath, transcriptPath, notePath };
}

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);
  if (!subcommand || !["record", "transcribe"].includes(subcommand)) {
    usage();
    process.exit(1);
  }

  const options = parseOptions(args, subcommand);
  if (subcommand === "transcribe" && !options.audio) {
    usage();
    process.exit(1);
  }

  const vaultPath = getVaultPath(options.site);
  const sessionDir = createSessionDir(options, vaultPath);
  const contextSections = collectContext(options, vaultPath);
  let audioPath = options.audio ? ensureReadableFile(options.audio) : undefined;

  if (subcommand === "record") {
    audioPath = await recordAudio(options, sessionDir);
  }

  if (!audioPath) throw new Error("Missing audio path.");
  console.log(`Audio: ${audioPath}`);

  if (!options.transcribe) {
    console.log(`Saved recording session: ${sessionDir}`);
    return;
  }

  console.log(`Transcribing with ${options.model} via ${options.baseUrl}`);
  const markdown = await transcribeAudio(options, audioPath, sessionDir, contextSections);
  const outputs = writeOutputs(options, sessionDir, markdown, audioPath, contextSections);
  console.log(`Wrote ${outputs.transcriptPath}`);
  console.log(`Wrote ${outputs.notePath}`);
  console.log(`Wrote ${outputs.outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
