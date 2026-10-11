import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Fixed public questions only. Recording never accepts a personal conversation.
export const learningScenarios = [
  { id: "dna-cartoon", questions: ["Explain DNA repair with a cartoon", "Can you make that simpler?"] },
  { id: "immune-recognition", questions: ["How does the immune system recognize cancer?"] },
  { id: "ctdna-lesson", currentSlug: "wiki/education/molecular-profiling/06-ctdna-and-mrd", questions: ["What can this tell us, and what can’t it tell us?"] },
  { id: "across-the-library", questions: ["Read the overview and target-selection sections of both the personalized cancer vaccine guide (wiki/education/guides/personalized-cancer-vaccine/index) and engineered cell therapy guide (wiki/education/guides/engineered-cell-therapy/index). Compare how they recognize a tumor, simply."] },
] as const;
export type LearningScenario = (typeof learningScenarios)[number];
export type GatewayExchange = {
  request: { model: string; body: unknown };
  response: { status: number; headers: Record<string, string>; body: string };
};
export type GatewayRecording = {
  version: 1; scenario: string; recordedAt: string; model: string;
  contentCommit: string; corpusSha256: string; sdk: { ai: string; gateway: string };
  turns: Array<{ question: string; exchanges: GatewayExchange[] }>;
};
export const fixtureDirectory = path.resolve(import.meta.dirname, "../fixtures/gateway");
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Canonicalizes key ordering only; evidence, instructions and tool results must match. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function readRecording(id: string): GatewayRecording {
  const value = JSON.parse(readFileSync(path.join(fixtureDirectory, `${id}.json`), "utf8")) as GatewayRecording;
  if (value.version !== 1 || value.scenario !== id || !value.turns?.length) throw Error(`Invalid Gateway recording: ${id}`);
  return value;
}
export function sseParts(sse: string): Array<Record<string, unknown>> {
  return sse.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
    return data && data !== "[DONE]" ? [JSON.parse(data)] : [];
  });
}
export function responseSnapshot(sse: string, exchanges: GatewayExchange[]) {
  const parts = sseParts(sse);
  const explanations: string[] = [];
  for (const part of parts) {
    if (part.type === "text-start") explanations.push("");
    if (part.type === "text-delta") explanations[explanations.length - 1] += part.delta;
  }
  const resources = parts.findLast(part => part.type === "data-education")?.data as { sections: unknown[]; illustrations: unknown[] } | undefined;
  return {
    gateway: exchanges.map(exchange => {
      const events = sseParts(exchange.response.body);
      return {
        status: exchange.response.status,
        text: events.filter(event => event.type === "text-delta").map(event => event.delta).join(""),
        tools: events.filter(event => event.type === "tool-call").map(event => ({ name: event.toolName, input: event.input })),
        finishReason: events.findLast(event => event.type === "finish")?.finishReason,
      };
    }),
    explanations,
    citations: [...new Set(explanations.join("\n").match(/\/education\/[^\s)]+/g) ?? [])],
    sections: resources?.sections ?? [], illustrations: resources?.illustrations ?? [],
    finishReason: parts.findLast(part => part.type === "finish")?.finishReason,
    errors: parts.filter(part => part.type === "error").map(part => part.errorText),
  };
}
