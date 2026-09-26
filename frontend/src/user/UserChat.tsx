import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { PanelLeft, Plus } from 'lucide-react';
import type { ConversationContextItem, QueryExecutionStatus } from '../types/index.js';
import { apiJson, apiPost } from '../lib/apiClient.js';
import type { ExportableAnswer } from '../lib/exportAnswer.js';
import { ArcVideo } from './ArcVideo.js';
import { SendButton } from './LiquidMetalSendButton.js';
import { ChatExportMenu } from './ChatExportMenu.js';
import {
  Sidebar,
  SidebarBody,
  SidebarRailMark,
  ThreadList,
  type ChatThreadSummary,
} from './ChatSidebar.js';
import { MarkdownMessage } from './MarkdownMessage.js';
import './user.css';

interface NormalizedResult {
  answer: string;
  columns: string[];
  rows: Record<string, unknown>[];
  suggestions: string[];
  status: QueryExecutionStatus;
  /** ArcGPT-Backend's id for the stored conversation, once it has created one. */
  conversationId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result?: NormalizedResult;
  isError?: boolean;
}

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  variant: 'intro' | 'conversation';
  autoFocus?: boolean;
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `arc-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Thread ids have to be UUIDs, not merely unique strings.
 *
 * ArcGPT-Backend only reuses a client-supplied `conversationId` if it is a
 * well-formed UUID; anything else is discarded and a new row is created on
 * every turn, which would silently fork one chat into many. So the fallback
 * here is a hand-rolled v4 rather than the `arc-message-...` string used for
 * message ids, which has no such constraint.
 */
function createThreadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const random = Math.floor(Math.random() * 16);
    const value = c === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const KNOWN_STATUSES: readonly QueryExecutionStatus[] = [
  'success',
  'empty',
  'blocked',
  'failed',
  'unauthorized',
  'clarification_needed',
  'not_available',
  'access_denied',
  'unsupported',
];

/**
 * Preserves the backend's status instead of guessing one.
 *
 * The previous version knew only four statuses and folded everything else into
 * `success`, so the backend's "no matching records" and "not permitted for your
 * role" replies were both presented as successful answers.
 */
function toStatus(value: string): QueryExecutionStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as QueryExecutionStatus)
    : 'failed';
}

function normalizeResponse(payload: unknown): NormalizedResult {
  const result = isRecord(payload) ? payload : {};
  const status = toStatus(asText(result.status));
  const columns = Array.isArray(result.columns)
    ? result.columns.filter((column): column is string => typeof column === 'string')
    : [];
  const rows = Array.isArray(result.rows)
    ? result.rows.filter(isRecord)
    : Array.isArray(result.data)
      ? result.data.filter(isRecord)
      : [];
  const suggestions = Array.isArray(result.clarificationSuggestions)
    ? result.clarificationSuggestions.filter((suggestion): suggestion is string => typeof suggestion === 'string')
    : [];
  const conversationId = asText(result.conversationId);

  return {
    answer:
      asText(result.naturalLanguageAnswer) ||
      asText(result.clarificationQuestion) ||
      'I could not find a clear answer for that question.',
    columns,
    rows,
    suggestions,
    status,
    ...(conversationId ? { conversationId } : {}),
  };
}

function updateConversationContext(
  current: ConversationContextItem[],
  query: string,
  result: NormalizedResult,
  contextSql?: string
): ConversationContextItem[] {
  // `empty` is a real answer — the pipeline ran and matched nothing — so it is
  // worth carrying forward as context. Blocked, failed and unauthorized turns
  // are not: they say nothing useful about the data.
  if (result.status !== 'success' && result.status !== 'empty' && result.status !== 'clarification_needed') {
    return current;
  }

  const nextContext: ConversationContextItem[] = [
    ...current,
    { role: 'user', content: query },
    {
      role: 'assistant',
      content: result.answer,
      ...(contextSql ? { sql: contextSql } : {}),
    },
  ];
  return nextContext.slice(-12);
}

function humanizeColumn(column: string): string {
  return column
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ResultTable({ result }: { result: NormalizedResult }) {
  if (result.columns.length === 0 || result.rows.length === 0) return null;

  return (
    <div className="arc-result-table-wrap">
      <table className="arc-result-table">
        <thead>
          <tr>
            {result.columns.map((column) => (
              <th key={column}>{humanizeColumn(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={`${result.columns.join('-')}-${rowIndex}`}>
              {result.columns.map((column) => (
                <td key={`${rowIndex}-${column}`}>{formatCell(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSubmit,
  isLoading,
  inputRef,
  variant,
  autoFocus = false,
}: ChatComposerProps) {
  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 28), 176)}px`;
  }, [inputRef]);

  useEffect(() => {
    resizeInput();
  }, [resizeInput, value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <form className={`arc-composer-form arc-composer-form--${variant}`} onSubmit={handleSubmit}>
      <div className="arc-composer">
        <textarea
          ref={inputRef}
          className="arc-composer-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Arc anything"
          rows={1}
          disabled={isLoading}
          autoFocus={autoFocus}
          aria-label="Ask Arc anything"
        />
        <SendButton disabled={isLoading || !value.trim()} />
      </div>
      <div className="arc-composer-caption" aria-hidden="true">
        <span>Dr. Srinivasan Alavandar</span>
        <span>Principal Access</span>
      </div>
    </form>
  );
}

function AssistantMessage({
  message,
  onSuggestion,
  isLoading,
}: {
  message: ChatMessage;
  onSuggestion: (suggestion: string) => void;
  isLoading: boolean;
}) {
  return (
    <article className={`arc-message arc-assistant-message${message.isError ? ' arc-error-message' : ''}`}>
      <div className="arc-assistant-mark" aria-hidden="true">
        *
      </div>
      <div className="arc-message-content">
        {message.isError ? (
          <p className="arc-error-copy">I couldn&apos;t complete that request. Please try again.</p>
        ) : (
          <>
            <MarkdownMessage content={message.content} />
            {message.result && <ResultTable result={message.result} />}
            {message.result && message.result.suggestions.length > 0 && (
              <div className="arc-suggestions" aria-label="Suggested follow-ups">
                {message.result.suggestions.map((suggestion) => (
                  <button
                    className="arc-suggestion"
                    key={suggestion}
                    type="button"
                    onClick={() => onSuggestion(suggestion)}
                    disabled={isLoading}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="arc-message arc-user-message">
      <div className="arc-user-bubble">{message.content}</div>
    </article>
  );
}

/**
 * Generation state for the conversation thread.
 *
 * The <video> is mounted for the whole life of the thread and only its
 * visibility is toggled, so the clip keeps playing from wherever it reached
 * instead of snapping back to frame 0 on every message. That also gives the
 * fade-out somewhere to happen: a conditionally rendered node would simply be
 * removed, which is exactly the sudden disappearance to avoid.
 *
 * `aria-hidden` carries the loading semantics so assistive tech is not told the
 * interface is working while the effect is invisible.
 */
function LoadingMessage({ active }: { active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let cancelled = false;

    const sync = () => {
      if (cancelled) return;
      // Pausing an inactive clip keeps it mounted without burning frames, and
      // resuming carries on from the same frame — the loop never visibly
      // restarts. Under reduced motion it stays held on its first frame.
      if (reduceMotion.matches) {
        video.pause();
        if (video.currentTime !== 0) video.currentTime = 0;
        return;
      }
      if (active) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };

    sync();
    reduceMotion.addEventListener('change', sync);
    return () => {
      cancelled = true;
      reduceMotion.removeEventListener('change', sync);
    };
  }, [active]);

  return (
    <div
      className={`arc-loading-message${active ? ' is-active' : ''}`}
      role="status"
      aria-label="Arc is working"
      aria-hidden={active ? undefined : true}
    >
      <span className="arc-thinking" aria-hidden="true">
        {/*
          Luma key. The clip is a yellow mark on an opaque black field, and the
          conversation's own backdrop sits a few values above pure black, so
          simply fading the video's alpha at its edges still leaves a dark disc
          sitting on that backdrop. Routing the pixels through feColorMatrix
          makes alpha follow luminance instead, so the black field becomes truly
          transparent and only the mark survives — there is no element edge left
          to see, because nothing is being drawn where the footage is black.
        */}
        <svg className="arc-luma-defs" aria-hidden="true" focusable="false">
          <defs>
            <filter id="arc-luma-key" colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0.2126 0.7152 0.0722 0 0"
              />
            </filter>
          </defs>
        </svg>
        <video
          ref={videoRef}
          className="arc-thinking-video"
          src="/arc/inside-chat-animation.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
        />
      </span>
    </div>
  );
}

interface ChatThread {
  id: string;
  /**
   * ArcGPT-Backend's `ai_conversations` id, present once the backend has
   * created or matched one. Kept separate from `id` so a locally-created
   * thread keeps its own identity while still being persisted server-side.
   */
  conversationId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /**
   * False for a thread that came from the server's history and whose transcript
   * has not been fetched yet. Those have no `messages` until they are opened,
   * so this flag is what keeps them visible in the sidebar and what triggers
   * the fetch on select.
   */
  messagesLoaded?: boolean;
  /** `messageCount` as reported by the server, for a thread not yet opened. */
  remoteMessageCount?: number;
}

/** A row as returned by `GET /api/conversations`. */
interface RemoteConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

function titleFromQuery(query: string): string {
  const trimmed = query.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'New Arc';
  return trimmed.length > 46 ? `${trimmed.slice(0, 45)}…` : trimmed;
}

export function UserChat() {
  const [phase, setPhase] = useState<'intro' | 'conversation'>('intro');
  // Thread list backing the history sidebar. The app previously held a single
  // message array, so the sidebar needs a small thread model; the active
  // thread's messages are what the chat renders, and the send/render paths are
  // otherwise untouched. Seeds from ArcGPT-Backend's stored conversations on
  // mount and stays authoritative in memory afterwards.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // Conversation follow-up context, kept per thread so switching threads does
  // not leak one thread's SQL context into another.
  const conversationContextRef = useRef<Map<string, ConversationContextItem[]>>(new Map());
  // Server-side conversation ids, mirrored out of `threads` so `submitMessage`
  // can read the current one without taking `threads` as a dependency.
  const conversationIdRef = useRef<Map<string, string>>(new Map());
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const isLoadingRef = useRef(false);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );
  const messages = useMemo(() => activeThread?.messages ?? [], [activeThread]);

  /**
   * The newest answer the export control offers, with the question that
   * produced it.
   *
   * Scanned backwards for the last assistant turn, which is not simply the last
   * message: an error turn has nothing to export, and an error turn is not
   * something the user can ask for a file of.
   *
   * A turn is exported with its result table when it has one. A transcript
   * restored from history stores the prose only — the backend does not keep
   * result rows — so those turns still export, just without a table and with
   * `restored` standing in for a status the server no longer has. Falling back
   * this way keeps the control usable in a restored thread instead of leaving
   * it permanently disabled with no explanation.
   *
   * The question is read from the turn immediately above, so it is the one that
   * was actually asked.
   */
  const latestExportAnswer = useMemo<ExportableAnswer | null>(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'assistant' || message.isError) continue;
      const question = messages[index - 1];
      return {
        question: question?.role === 'user' ? question.content : '',
        answer: message.content,
        status: message.result?.status ?? 'restored',
        columns: message.result?.columns ?? [],
        rows: message.result?.rows ?? [],
      };
    }
    return null;
  }, [messages]);

  // Newest first, which is how a history list is read. A thread with no loaded
  // messages is still listed: that is a stored conversation the user has not
  // opened yet, not an empty one.
  const threadSummaries = useMemo<ChatThreadSummary[]>(
    () =>
      threads
        .filter((thread) => thread.messages.length > 0 || thread.messagesLoaded === false)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => ({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
          // For a thread restored from the server the transcript has not been
          // fetched yet, so its length is 0; the server's own count stands in
          // until it is opened.
          messageCount:
            thread.messages.length > 0 ? thread.messages.length : (thread.remoteMessageCount ?? 0),
        })),
    [threads]
  );

  /**
   * Applies a functional message update to one specific thread.
   *
   * The thread id is passed explicitly rather than read from `activeThreadId`
   * inside the updater: a question that opens a new Arc sets that id in the
   * same tick, so a closure over the previous value would miss the update and
   * drop the message.
   */
  const updateThreadMessages = useCallback(
    (threadId: string, updater: (current: ChatMessage[]) => ChatMessage[]) => {
      setThreads((currentThreads) => {
        const index = currentThreads.findIndex((thread) => thread.id === threadId);
        if (index < 0) return currentThreads;
        const next = currentThreads.slice();
        next[index] = {
          ...next[index],
          messages: updater(next[index].messages),
          updatedAt: Date.now(),
        };
        return next;
      });
    },
    []
  );

  const scrollToLatest = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
      });
    });
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ArcGPT — Ask anything';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    if (phase === 'conversation') {
      inputRef.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'conversation') scrollToLatest();
  }, [isLoading, messages, phase, scrollToLatest]);

  const submitMessage = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || isLoadingRef.current) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const controller = new AbortController();
      requestControllerRef.current = controller;
      isLoadingRef.current = true;
      setIsLoading(true);
      setPhase('conversation');
      setDraft('');

      // A question always lands in a thread: reuse the active one, or start one.
      const threadId = activeThreadId ?? createThreadId();
      const now = Date.now();
      setThreads((current) =>
        current.some((thread) => thread.id === threadId)
          ? current.map((thread) =>
              // A follow-up inside an untouched thread gives it its title.
              thread.id === threadId && thread.title === 'New Arc'
                ? { ...thread, title: titleFromQuery(query) }
                : thread
            )
          : [
              ...current,
              {
                id: threadId,
                title: titleFromQuery(query),
                createdAt: now,
                updatedAt: now,
                messages: [],
                messagesLoaded: true,
              },
            ]
      );
      if (!activeThreadId) setActiveThreadId(threadId);

      updateThreadMessages(threadId, (current) => [
        ...current,
        {
          id: createMessageId(),
          role: 'user',
          content: query,
        },
      ]);

      try {
        // The conversationId is what makes ArcGPT-Backend persist the turn, and
        // it is always sent. On a thread's first question it is the thread's own
        // UUID: the backend finds no conversation under it, creates one, and
        // answers with the id it actually assigned, which is adopted below.
        // Sending nothing on the first turn would persist nothing at all and
        // the thread would silently never reach the history sidebar.
        const conversationId = conversationIdRef.current.get(threadId) ?? threadId;
        const payload = await apiJson<unknown>(
          '/api/query/translate',
          apiPost(
            {
              query,
              conversationHistory: conversationContextRef.current.get(threadId) ?? [],
              conversationId,
            },
            controller.signal
          )
        );

        const result = normalizeResponse(payload);
        const contextSql = isRecord(payload)
          ? asText(payload.sanitizedSql) || asText(payload.generatedSql) || undefined
          : undefined;
        if (requestId !== requestIdRef.current) return;

        if (result.conversationId) {
          conversationIdRef.current.set(threadId, result.conversationId);
          setThreads((current) =>
            current.map((thread) =>
              thread.id === threadId ? { ...thread, conversationId: result.conversationId } : thread
            )
          );
        }

        // Forward the existing opaque follow-up context without rendering query text in the chat.
        conversationContextRef.current.set(
          threadId,
          updateConversationContext(
            conversationContextRef.current.get(threadId) ?? [],
            query,
            result,
            contextSql
          )
        );
        updateThreadMessages(threadId, (current) => [
          ...current,
          {
            id: createMessageId(),
            role: 'assistant',
            content: result.answer,
            result,
          },
        ]);
      } catch {
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        updateThreadMessages(threadId, (current) => [
          ...current,
          {
            id: createMessageId(),
            role: 'assistant',
            content: '',
            isError: true,
          },
        ]);
      } finally {
        if (requestId === requestIdRef.current) {
          requestControllerRef.current = null;
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }

      scrollToLatest();
    },
    [scrollToLatest, activeThreadId, updateThreadMessages]
  );

  /**
   * "+ New Arc". Previously this wiped the single message array; it now
   * starts a fresh thread and leaves the previous one in the history. The
   * visible result is identical — intro hero, empty composer — so the existing
   * control behaves exactly as before, it just no longer discards the thread.
   */
  const startNewThread = useCallback(() => {
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    isLoadingRef.current = false;
    setIsLoading(false);
    setActiveThreadId(null);
    setDraft('');
    setPhase('intro');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  /**
   * Seeds the sidebar from ArcGPT-Backend's stored conversations.
   *
   * The sidebar markup, ordering and rendering are untouched — only the source
   * of the list changed. A locally-created thread always wins over a server row
   * with the same conversation id, so a thread the user is already looking at
   * is never replaced by a possibly staler copy of itself. Failures are
   * swallowed on purpose: an unreachable history list must not stop the chat
   * from working.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const remote = await apiJson<RemoteConversationSummary[]>('/api/conversations?limit=50');
        if (cancelled || !Array.isArray(remote) || remote.length === 0) return;
        setThreads((current) => {
          const known = new Set<string>();
          current.forEach((thread) => {
            if (thread.conversationId) known.add(thread.conversationId);
          });
          const additions: ChatThread[] = remote
            .filter((item) => isRecord(item) && typeof item.id === 'string' && !known.has(item.id))
            .map((item) => {
              const updatedAt = Date.parse(item.updatedAt);
              const timestamp = Number.isNaN(updatedAt) ? Date.now() : updatedAt;
              return {
                id: item.id,
                conversationId: item.id,
                title: asText(item.title) || 'New Arc',
                createdAt: timestamp,
                updatedAt: timestamp,
                messages: [],
                messagesLoaded: false,
                remoteMessageCount:
                  typeof item.messageCount === 'number' ? item.messageCount : undefined,
              };
            });
          if (additions.length === 0) return current;
          // A server-backed thread's local id and its conversation id are the
          // same value, so the mirror is a straight copy.
          additions.forEach((thread) => {
            conversationIdRef.current.set(thread.id, thread.id);
          });
          return [...current, ...additions];
        });
      } catch {
        // History is a convenience; the chat itself is unaffected.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Opens a thread, fetching its transcript the first time if it came from the
   * server and has not been read yet.
   *
   * The backend stores the role and text of each turn but not the result table,
   * so a restored assistant message is the answer's prose without the rows
   * beneath it. Re-asking the question brings the table back; the transcript
   * itself is complete.
   */
  const selectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
      setPhase('conversation');
      setDraft('');

      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread || thread.messagesLoaded !== false) return;
      const conversationId = thread.conversationId;
      if (!conversationId) return;

      void (async () => {
        try {
          const payload = await apiJson<{ messages?: Array<{ id: string; role: string; content: string }> }>(
            `/api/conversations/${encodeURIComponent(conversationId)}`
          );
          const stored = Array.isArray(payload?.messages) ? payload.messages : [];
          setThreads((current) =>
            current.map((entry) =>
              entry.id === threadId
                ? {
                    ...entry,
                    messagesLoaded: true,
                    messages: stored
                      .filter((message) => message.role === 'user' || message.role === 'assistant')
                      .map((message) => ({
                        id: message.id,
                        role: message.role as 'user' | 'assistant',
                        content: message.content,
                      })),
                  }
                : entry
            )
          );
          conversationContextRef.current.set(
            threadId,
            stored
              .filter((message) => message.role === 'user' || message.role === 'assistant')
              .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
          );
        } catch {
          setThreads((current) =>
            current.map((entry) => (entry.id === threadId ? { ...entry, messagesLoaded: true } : entry))
          );
        }
      })();
    },
    [threads]
  );

  useEffect(() => {
    if (!sidebarOpen) return;
    // The React KeyboardEvent type shadows the DOM one here; this listener is
    // attached to window, so it receives a native event.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (phase === 'intro') return;
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.style.height = '0px';
      input.style.height = `${Math.min(Math.max(input.scrollHeight, 28), 176)}px`;
    });
  };

  return (
    <div className="arc-user-root">
      {phase === 'conversation' && (
        <ArcVideo className="arc-chat-bg" src="/arc/chat-asterisk-rotate.mp4" />
      )}

      {/*
        The history panel is mounted once here, above both the landing and the
        chat view, so the two screens share a single sidebar instance, one
        `open` flag and one thread list. Only the page content is swapped.
      */}
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen}>
        <div className="arc-chat-shell">
          <SidebarBody>
            <SidebarRailMark onOpen={() => setSidebarOpen(true)} />
            <ThreadList
              threads={threadSummaries}
              activeId={activeThreadId}
              onSelect={selectThread}
              onNewThread={() => {
                startNewThread();
                setSidebarOpen(false);
              }}
            />
          </SidebarBody>

          <div className="arc-page">
            {phase === 'intro' ? (
              <main className="arc-intro" aria-label="Arc AI chat">
                {/* The trigger is absolutely positioned, so the centred hero
                    and composer keep their exact place when it is added. */}
                <button
                  className="arc-history-toggle arc-history-toggle--floating"
                  type="button"
                  onClick={() => setSidebarOpen((open) => !open)}
                  aria-label="Toggle chat history"
                  aria-expanded={sidebarOpen}
                  title="Chat history"
                >
                  <PanelLeft size={15} strokeWidth={1.8} />
                </button>
                <div className="arc-hero-mark">
                  <ArcVideo />
                </div>
                <div className="arc-intro-composer">
                  <ChatComposer
                    value={draft}
                    onChange={handleDraftChange}
                    onSubmit={() => void submitMessage(draft)}
                    isLoading={isLoading}
                    inputRef={inputRef}
                    variant="intro"
                    autoFocus
                  />
                </div>
              </main>
            ) : (
              <main className="arc-conversation" aria-label="Arc AI conversation">
                <header className="arc-chat-topbar">
                  <div className="arc-mini-brand" aria-label="ArcGPT">
                    <img
                      className="arc-mini-brand-mark"
                      src="/brand/arcgpt-mark-gold.png"
                      alt=""
                      width={20}
                      height={20}
                    />
                    <span>ArcGPT</span>
                  </div>
                  <div className="arc-chat-topbar-actions">
                    <button
                      className="arc-history-toggle"
                      type="button"
                      onClick={() => setSidebarOpen((open) => !open)}
                      aria-label="Toggle chat history"
                      aria-expanded={sidebarOpen}
                      title="Chat history"
                    >
                      <PanelLeft size={15} strokeWidth={1.8} />
                    </button>
                    <ChatExportMenu answer={latestExportAnswer} disabled={isLoading} />
                    <button className="arc-new-thread" type="button" onClick={startNewThread}>
                      <Plus size={14} strokeWidth={1.8} />
                      <span>New Arc</span>
                    </button>
                  </div>
                </header>

                <div className="arc-thread-scroll" ref={threadRef}>
                  <div className="arc-thread" aria-live="polite">
                    {messages.map((message) =>
                      message.role === 'user' ? (
                        <UserMessage key={message.id} message={message} />
                      ) : (
                        <AssistantMessage
                          key={message.id}
                          message={message}
                          isLoading={isLoading}
                          onSuggestion={(suggestion) => void submitMessage(suggestion)}
                        />
                      )
                    )}
                    <LoadingMessage active={isLoading} />
                  </div>
                </div>

                <div className="arc-composer-dock">
                  <ChatComposer
                    value={draft}
                    onChange={handleDraftChange}
                    onSubmit={() => void submitMessage(draft)}
                    isLoading={isLoading}
                    inputRef={inputRef}
                    variant="conversation"
                  />
                </div>
              </main>
            )}
          </div>
        </div>
      </Sidebar>
    </div>
  );
}
