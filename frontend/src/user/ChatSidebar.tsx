import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, X } from 'lucide-react';

/**
 * Chat-history sidebar for the user end.
 *
 * Adapted from `web assets/q_sidebar.tsx`. Structure and motion are kept:
 * a context-driven open/close, a desktop rail that expands, a full-screen
 * mobile drawer, and labels that animate in with the panel. Three deliberate
 * departures, all forced by the host project rather than chosen:
 *
 *  - `@/lib/utils`'s `cn` -> a local `cx`; the project has no `src/lib`.
 *  - `@tabler/icons-react` -> `lucide-react`, already a dependency. Adding
 *    a second icon set for two glyphs would be needless weight.
 *  - Tailwind `bg-neutral-100/800` -> `arc-*` classes in user.css, so the
 *    panel uses the same black + white/gray + gold tokens as the chat rather
 *    than a second, greyer design language.
 *
 * The single `open` flag is owned by UserChat and passed down, so the panel
 * never keeps a second copy of the state and cannot drift out of sync.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Breakpoint flag, kept in React state rather than left to CSS alone.
 *
 * `SidebarBody` renders a desktop rail and a mobile drawer, and the drawer's
 * scroll area carries a mask that would apply to a real scrollbar if it were
 * merely hidden by `display: none`. Mounting only the variant that the current
 * viewport actually uses keeps one DOM, one scroll container and one set of
 * rows at all times.
 */
const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isMobile;
}

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a Sidebar provider');
  return context;
}

export function Sidebar({
  open,
  setOpen,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

/**
 * Renders the rail on desktop and the drawer on small screens. Only one is
 * mounted at a time (see `useIsMobile`), so the history list exists once.
 */
export function SidebarBody({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileSidebar>{children}</MobileSidebar>
  ) : (
    <DesktopSidebar>{children}</DesktopSidebar>
  );
}

/**
 * Desktop rail. The asset expands on hover, which is kept, but hover is only
 * allowed to drive the panel while the pointer is a fine one and the user has
 * not taken manual control (via the toggle or Escape) — otherwise a click on
 * the toggle would be undone the instant the pointer drifted away.
 */
export function DesktopSidebar({ children }: { children: ReactNode }) {
  const { open, setOpen } = useSidebar();
  const [manual, setManual] = useState(false);

  const handleEnter = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // Only a real mouse expands the rail; a touch drag across the left edge
      // would otherwise open the panel over the conversation.
      if (event.pointerType !== 'mouse') return;
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      if (manual) return;
      setOpen(true);
    },
    [manual, setOpen]
  );

  const handleLeave = useCallback(() => {
    if (manual) return;
    setOpen(false);
  }, [manual, setOpen]);

  return (
    <motion.aside
      className="arc-sidebar-desktop"
      aria-label="Chat history"
      initial={false}
      animate={{ width: open ? 300 : 60 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocusCapture={() => setManual(true)}
    >
      {children}
    </motion.aside>
  );
}

/** Full-screen drawer with a scrim, so the chat is never squeezed on a phone. */
export function MobileSidebar({ children }: { children: ReactNode }) {
  const { open, setOpen } = useSidebar();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="arc-sidebar-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <motion.aside
            className="arc-sidebar-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Chat history"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              className="arc-sidebar-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat history"
            >
              <X size={16} strokeWidth={1.8} />
            </button>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function formatWhen(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * History list. The fade-and-scroll treatment comes from
 * `scroll_with_fade_listing_numbers.tsx`: rows on a translucent surface with a
 * hairline divider, masked so the list dissolves at both ends while it scrolls.
 * Its fixed `00..10` placeholders are replaced with the real threads, and the
 * row label keeps the same two-part composition (title, then rule).
 *
 * The asset's scrolling primitive was a shadcn/Radix `ScrollArea`; Radix is not
 * a dependency here, and a masked native scroller gives the same fade in a few
 * lines, so that is what is used.
 */
export function ThreadList({
  threads,
  activeId,
  onSelect,
  onNewThread,
}: {
  threads: ChatThreadSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewThread: () => void;
}) {
  const { open, setOpen } = useSidebar();

  // Collapsed: the rail mark is the only affordance, so the list contributes
  // nothing and cannot wrap text inside the 60px column.
  if (!open) return null;

  if (threads.length === 0) {
    return (
      <div className="arc-thread-list-wrap">
        <button type="button" className="arc-thread-new" onClick={onNewThread}>
          <Plus size={14} strokeWidth={1.8} />
          <span className="arc-thread-new-label">New Arc</span>
        </button>
        <p className="arc-thread-empty">No conversations yet</p>
      </div>
    );
  }

  return (
    <div className="arc-thread-list-wrap">
      <button type="button" className="arc-thread-new" onClick={onNewThread}>
        <Plus size={14} strokeWidth={1.8} />
        <span className="arc-thread-new-label">New Arc</span>
      </button>

      <nav className="arc-thread-list" aria-label="Previous conversations">
        {threads.map((thread) => {
          const isActive = thread.id === activeId;
          return (
            <button
              key={thread.id}
              type="button"
              className={`arc-thread-row${isActive ? ' is-active' : ''}`}
              onClick={() => {
                onSelect(thread.id);
                setOpen(false);
              }}
              aria-current={isActive ? 'true' : undefined}
              title={thread.title}
            >
              <span className="arc-thread-row-text">
                <span className="arc-thread-row-title">{thread.title}</span>
                <span className="arc-thread-row-rule" aria-hidden="true" />
              </span>
              <span className="arc-thread-row-when">{formatWhen(thread.updatedAt)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Rail affordance while the panel is collapsed: the brand mark, which opens the
 * history. The panel's own "+ New Arc" is only rendered while expanded, so
 * this is the only control the closed rail shows — two stacked glyphs read as
 * noise in a 60px column.
 */
export function SidebarRailMark({ onOpen }: { onOpen: () => void }) {
  const { open } = useSidebar();
  if (open) return null;
  return (
    <button
      type="button"
      className="arc-sidebar-rail-mark"
      onClick={onOpen}
      aria-label="Open chat history"
      title="Chat history"
    >
      <img src={`${import.meta.env.BASE_URL}brand/arcgpt-mark-gold.png`} alt="" width={22} height={22} />
    </button>
  );
}
