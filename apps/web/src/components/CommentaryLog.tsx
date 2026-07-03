import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCommentaryTextParts } from "../lib/glossary-note";
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  filterCommentaryItems,
  groupCommentaryItems,
  type CommentaryItem,
  type LogEventTypeFilter,
} from "../lib/log-filter";
import type { CommentaryDisplayMode } from "../types";
import { normalizeSuggestion } from "../lib/text";

const LOG_AUTO_SCROLL_THRESHOLD_PX = 64;
const GENERIC_LOG_SUMMARIES = new Set(["ログ更新"]);
const GROUP_DETAIL_PREVIEW_COUNT = 3;

const unique = (values: Array<string | undefined>): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSuggestion(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const formatLogTimeRange = (startTs: number, endTs: number): string => {
  const start = new Date(startTs).toLocaleTimeString();
  if (startTs === endTs) return start;
  const end = new Date(endTs).toLocaleTimeString();
  return `${start} - ${end}`;
};

type CommentaryLogProps = {
  items: CommentaryItem[];
  displayMode: CommentaryDisplayMode;
};

export function CommentaryLog({ items, displayMode }: CommentaryLogProps) {
  const [query, setQuery] = useState("");
  const [eventType, setEventType] = useState<LogEventTypeFilter>("all");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);
  const filteredItems = useMemo(
    () => filterCommentaryItems(items, { query, eventType }),
    [eventType, items, query]
  );
  const groupedItems = useMemo(() => groupCommentaryItems(filteredItems), [filteredItems]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickRef.current = distanceToBottom <= LOG_AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldStickRef.current) return;

    const frame = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [filteredItems]);

  return (
    <>
      <div className="log-toolbar panel">
        <div className="log-toolbar__controls">
          <input
            className="log-toolbar__search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ログを検索（本文/詳細/種別）"
          />
          <select
            className="log-toolbar__type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as LogEventTypeFilter)}
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="log-toolbar__meta">
          {filteredItems.length} / {items.length} 件
          {groupedItems.length !== filteredItems.length && `（表示 ${groupedItems.length} カード）`}
        </div>
      </div>

      <div ref={containerRef} className="log-container" onScroll={handleScroll}>
        {filteredItems.length === 0 ? (
          <div className="log-empty">条件に一致するログはありません。</div>
        ) : (
          groupedItems.map((group, index) => {
            const item = group.latest;
            const parts = getCommentaryTextParts({
              narration: item.narration,
              explanation: item.explanation,
              glossaryNotes: item.glossaryNotes,
            });
            const notes = parts.glossaryNotes;
            const detailEntries = unique(group.items.map((entry) => entry.detail));
            const summaryEntries = unique(
              group.items
                .map((entry) => entry.summary)
                .filter((entry) => entry && !GENERIC_LOG_SUMMARIES.has(entry))
            );
            const detailPreview = detailEntries.slice(-GROUP_DETAIL_PREVIEW_COUNT);
            const hiddenDetailCount = Math.max(0, detailEntries.length - detailPreview.length);
            const isGrouped = group.count > 1;
            const latestSummary = summaryEntries.at(-1);
            const hasUsefulSummary = summaryEntries.length > 0;
            const groupHint = isGrouped
              ? `同じ流れのログが ${group.count} 件続いたので、最新の内容を代表で見せています。`
              : null;
            const showNarration = displayMode !== "explanation" && Boolean(parts.narrationText);
            const showExplanation = displayMode !== "narration" && Boolean(parts.explanationText);
            const primaryText = showNarration
              ? parts.narrationText
              : showExplanation
                ? parts.explanationText
                : null;
            const showExplanationBody = showNarration && showExplanation;

            return (
              <div key={`${group.key}-${index}`} className="log-item">
                <div className="log-item__header">
                  <div className="log-item__time">{formatLogTimeRange(group.startTs, group.endTs)}</div>
                  <div className="log-item__header-meta">
                    <div className="log-item__type">{EVENT_TYPE_LABELS[item.eventType]}</div>
                    {isGrouped && <div className="log-item__group-badge">{group.count}件まとめ</div>}
                  </div>
                </div>
                {primaryText && <div className="log-item__text">{primaryText}</div>}
                {(groupHint || showExplanationBody || notes.length > 0) && (
                  <div className="log-item__explain">
                    {groupHint && (
                      <div className="log-item__explain-body">
                        <div className="log-item__section-label">まとめ表示</div>
                        <div className="log-item__explain-text">{groupHint}</div>
                      </div>
                    )}
                    {showExplanationBody && parts.explanationText && (
                      <div className="log-item__explain-body">
                        <div className="log-item__section-label">やさしい説明</div>
                        <div className="log-item__explain-text">{parts.explanationText}</div>
                      </div>
                    )}
                    {notes.length > 0 && (
                      <div className="log-item__note-block" aria-label="用語注釈">
                        <div className="log-item__section-label">用語補足</div>
                        <div className="log-item__note">
                          {notes.map((note) => (
                            <span key={note} className="log-item__note-chip">
                              {note}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(hasUsefulSummary || detailPreview.length > 0) && (
                  <div className="log-item__raw">
                    {hasUsefulSummary && (
                      <div className="log-item__meta-row">
                        <div className="log-item__section-label">検出イベント</div>
                        {summaryEntries.length === 1 ? (
                          <div className="log-item__summary">{latestSummary}</div>
                        ) : (
                          <div className="log-item__summary-list">
                            {summaryEntries.map((entry) => (
                              <div key={entry} className="log-item__summary">
                                {entry}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {detailPreview.length > 0 && (
                      <div className="log-item__meta-row">
                        <div className="log-item__section-label">{isGrouped ? "原文プレビュー" : "原文"}</div>
                        <div className="log-item__detail-stack">
                          {detailPreview.map((entry, previewIndex) => (
                            <pre key={`${group.key}-detail-${previewIndex}`} className="log-item__detail">
                              {entry}
                            </pre>
                          ))}
                        </div>
                        {hiddenDetailCount > 0 && (
                          <div className="log-item__detail-more">
                            さらに {hiddenDetailCount} 件の近いログがあります。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
