import type { CommentarySpeech, EventPriority, EventType } from "../types";
import { buildCombinedCommentaryText } from "./glossary-note";

export type LogEventTypeFilter = "all" | EventType;

export type CommentaryItem = {
  ts: number;
  narration?: string;
  explanation?: string;
  glossaryNotes?: string[];
  eventType: EventType;
  priority?: EventPriority;
  summary?: string;
  detail?: string;
  speech?: CommentarySpeech;
};

export type GroupedCommentaryItem = {
  key: string;
  eventType: EventType;
  count: number;
  startTs: number;
  endTs: number;
  latest: CommentaryItem;
  items: CommentaryItem[];
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  start: "開始",
  stdout: "標準出力",
  stderr: "標準エラー",
  read: "読取",
  write: "更新",
  search: "検索",
  test: "テスト",
  git: "Git",
  github: "GitHub",
  install: "インストール",
  build: "ビルド",
  lint: "Lint",
  server: "サーバー",
  error: "エラー",
  done: "完了",
};

export const EVENT_TYPE_OPTIONS: Array<{ value: LogEventTypeFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "start", label: EVENT_TYPE_LABELS.start },
  { value: "stdout", label: EVENT_TYPE_LABELS.stdout },
  { value: "stderr", label: EVENT_TYPE_LABELS.stderr },
  { value: "read", label: EVENT_TYPE_LABELS.read },
  { value: "write", label: EVENT_TYPE_LABELS.write },
  { value: "search", label: EVENT_TYPE_LABELS.search },
  { value: "test", label: EVENT_TYPE_LABELS.test },
  { value: "git", label: EVENT_TYPE_LABELS.git },
  { value: "github", label: EVENT_TYPE_LABELS.github },
  { value: "install", label: EVENT_TYPE_LABELS.install },
  { value: "build", label: EVENT_TYPE_LABELS.build },
  { value: "lint", label: EVENT_TYPE_LABELS.lint },
  { value: "server", label: EVENT_TYPE_LABELS.server },
  { value: "error", label: EVENT_TYPE_LABELS.error },
  { value: "done", label: EVENT_TYPE_LABELS.done },
];

const SEARCHABLE_EVENT_TYPES = new Set<EventType>(Object.keys(EVENT_TYPE_LABELS) as EventType[]);
const GROUPABLE_EVENT_TYPES = new Set<EventType>([
  "stdout",
  "search",
  "read",
  "git",
  "github",
  "test",
  "install",
  "build",
  "lint",
]);
const GROUP_WINDOW_MS = 15000;

const normalizeGroupText = (item: CommentaryItem): string =>
  (item.narration ||
    buildCombinedCommentaryText({
      narrationText: item.narration ?? null,
      explanationText: item.explanation ?? null,
      glossaryNotes: item.glossaryNotes ?? [],
    }))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[「」『』“”"]/g, "")
    .trim();

export const getCommentaryGroupKey = (item: CommentaryItem): string | null => {
  if (!GROUPABLE_EVENT_TYPES.has(item.eventType)) return null;
  const textKey = normalizeGroupText(item);
  if (!textKey) return null;
  return `${item.eventType}:${textKey}`;
};

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && SEARCHABLE_EVENT_TYPES.has(value as EventType);
}

export function filterCommentaryItems(
  items: CommentaryItem[],
  filter: { query: string; eventType: LogEventTypeFilter }
): CommentaryItem[] {
  const query = filter.query.trim().toLowerCase();

  return items.filter((item) => {
    if (filter.eventType !== "all" && item.eventType !== filter.eventType) return false;
    if (!query) return true;

    const haystack = [
      item.narration ?? "",
      item.explanation ?? "",
      item.glossaryNotes?.join(" ") ?? "",
      item.summary ?? "",
      item.detail ?? "",
      item.eventType,
      EVENT_TYPE_LABELS[item.eventType],
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

export function groupCommentaryItems(items: CommentaryItem[]): GroupedCommentaryItem[] {
  const groups: GroupedCommentaryItem[] = [];

  for (const item of items) {
    const key = getCommentaryGroupKey(item);
    const previous = groups.at(-1);

    if (
      key &&
      previous &&
      previous.key === key &&
      item.ts - previous.endTs <= GROUP_WINDOW_MS
    ) {
      previous.count += 1;
      previous.endTs = item.ts;
      previous.latest = item;
      previous.items.push(item);
      continue;
    }

    groups.push({
      key: key ?? `${item.eventType}:${item.ts}:${groups.length}`,
      eventType: item.eventType,
      count: 1,
      startTs: item.ts,
      endTs: item.ts,
      latest: item,
      items: [item],
    });
  }

  return groups;
}
