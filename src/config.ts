import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ContextPruneConfig, PruneOn, SummarizerThinking } from "./types.js";
import {
  DEFAULT_CONFIG,
  DEFAULT_MANUAL_PRUNE_CONCURRENCY,
  DEFAULT_MIN_RAW_CHARS_THRESHOLD,
  MANUAL_PRUNE_CONCURRENCY_MAX,
  MANUAL_PRUNE_CONCURRENCY_MIN,
  PRUNE_ON_MODES,
  SUMMARIZER_THINKING_LEVELS,
} from "./types.js";
export { DEFAULT_MANUAL_PRUNE_CONCURRENCY, DEFAULT_MIN_RAW_CHARS_THRESHOLD } from "./types.js";

/** Path to the extension's own settings file, independent of any project. */
export const SETTINGS_PATH = join(getAgentDir(), "context-prune", "settings.json");

function isPruneOn(value: unknown): value is PruneOn {
  return typeof value === "string" && PRUNE_ON_MODES.some((mode) => mode.value === value);
}

function isSummarizerThinking(value: unknown): value is SummarizerThinking {
  return typeof value === "string" && SUMMARIZER_THINKING_LEVELS.some((level) => level.value === value);
}

function normalizeMinRawCharsThreshold(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_MIN_RAW_CHARS_THRESHOLD;
}

export function normalizeManualPruneConcurrency(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    && Math.floor(value) >= MANUAL_PRUNE_CONCURRENCY_MIN
    && Math.floor(value) <= MANUAL_PRUNE_CONCURRENCY_MAX
    ? Math.floor(value)
    : DEFAULT_MANUAL_PRUNE_CONCURRENCY;
}
/** Reads ~/.pi/agent/context-prune/settings.json and returns the config (or defaults). */
export async function loadConfig(): Promise<ContextPruneConfig> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf-8");
    const existing = JSON.parse(raw);
    const merged = { ...DEFAULT_CONFIG, ...existing };
    return {
      ...merged,
      enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULT_CONFIG.enabled,
      showPruneStatusLine:
        typeof merged.showPruneStatusLine === "boolean"
          ? merged.showPruneStatusLine
          : DEFAULT_CONFIG.showPruneStatusLine,
      showStartupNotice:
        typeof merged.showStartupNotice === "boolean"
          ? merged.showStartupNotice
          : DEFAULT_CONFIG.showStartupNotice,
      pruneOn: isPruneOn(merged.pruneOn) ? merged.pruneOn : DEFAULT_CONFIG.pruneOn,
      summarizerThinking: isSummarizerThinking(merged.summarizerThinking)
        ? merged.summarizerThinking
        : DEFAULT_CONFIG.summarizerThinking,
      remindUnprunedCount:
        typeof merged.remindUnprunedCount === "boolean"
          ? merged.remindUnprunedCount
          : DEFAULT_CONFIG.remindUnprunedCount,
      notifySkipped:
        typeof merged.notifySkipped === "boolean" ? merged.notifySkipped : DEFAULT_CONFIG.notifySkipped,
      minRawCharsThreshold: normalizeMinRawCharsThreshold(merged.minRawCharsThreshold),
      manualPruneConcurrency: normalizeManualPruneConcurrency(merged.manualPruneConcurrency),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Writes the full config to ~/.pi/agent/context-prune/settings.json. */
export async function saveConfig(config: ContextPruneConfig): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(config, null, 2));
}
