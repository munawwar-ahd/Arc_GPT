import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import {
  downloadAnswerCsv,
  openAnswerPrintPreview,
  type ExportableAnswer,
} from '../lib/exportAnswer.js';

interface ChatExportMenuProps {
  /** The answer the menu exports, or `null` before anything has been answered. */
  answer: ExportableAnswer | null;
  /** True while Arc is generating, so the menu is not offered mid-turn. */
  disabled?: boolean;
}

interface MenuEntry {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
}

/**
 * "Export" split button in the conversation topbar.
 *
 * Opens a menu rather than doing the export on click, because the two formats
 * are genuinely different products — a CSV is a data hand-off, a PDF is a
 * report to read — and a single button would have to guess which one was meant.
 *
 * Only the newest answer is exportable, per the design decision for this
 * control: the menu is disabled until ArcGPT has answered at least once, and
 * while a new turn is generating, so the file always matches what is on screen.
 */
export function ChatExportMenu({ answer, disabled = false }: ChatExportMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const isDisabled = disabled || answer === null;

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // A pointer press anywhere outside the control dismisses the menu. Listening on
  // `pointerdown` rather than `click` closes it in the same gesture as the click
  // that landed elsewhere, instead of leaving it up until the next click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // The payload is replaced as every turn arrives, so a menu left open would be
  // pointing at an answer the user never saw. React replaces the `answer`
  // object on each new turn, so identity is a reliable signal here; this also
  // covers the generation case, since `disabled` flips in the same commit.
  useEffect(() => {
    setOpen(false);
  }, [answer]);

  const menuEntries = useMemo<MenuEntry[]>(() => {
    const current = answer;
    if (!current) return [];
    return [
      {
        id: 'pdf',
        label: 'Download PDF',
        hint: 'Formatted report for reading or printing',
        icon: <FileText size={14} strokeWidth={1.8} />,
        run: () => openAnswerPrintPreview(current),
      },
      {
        id: 'csv',
        label: 'Download CSV',
        hint: 'Answer and result rows as a spreadsheet',
        icon: <FileSpreadsheet size={14} strokeWidth={1.8} />,
        run: () => downloadAnswerCsv(current),
      },
    ];
  }, [answer]);

  /** Roving focus, so the menu is reachable and traversable from the keyboard. */
  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('.arc-export-item') ?? []
    );
    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? step > 0
          ? 0
          : items.length - 1
        : (currentIndex + step + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  /** Opens the menu and lands focus on its first item. */
  const openMenu = () => {
    if (isDisabled) return;
    setOpen(true);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('.arc-export-item')?.focus();
    });
  };

  return (
    <div
      className="arc-export"
      ref={containerRef}
      // Tabbing past the last item must not leave the menu hanging open with
      // focus somewhere else on the page.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className="arc-export-trigger"
        type="button"
        onClick={() => (open ? close() : openMenu())}
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={isDisabled ? 'Nothing to export yet' : 'Export the latest answer'}
      >
        <Download size={14} strokeWidth={1.8} />
        <span>Export</span>
        <ChevronDown
          className="arc-export-caret"
          size={12}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="arc-export-menu"
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Export options"
          onKeyDown={moveFocus}
        >
          {menuEntries.map((entry) => (
            <button
              key={entry.id}
              className="arc-export-item"
              type="button"
              role="menuitem"
              onClick={entry.run}
            >
              <span className="arc-export-item-icon" aria-hidden="true">
                {entry.icon}
              </span>
              <span className="arc-export-item-text">
                <span className="arc-export-item-label">{entry.label}</span>
                <span className="arc-export-item-hint">{entry.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
