import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';
import type { AvailableModel } from '../types/index.js';

interface ModelSelectorProps {
  /** Every model the backend reported, with availability measured live. */
  models: AvailableModel[];
  /** The id of the selected model, or '' when nothing has been chosen yet. */
  selectedId: string;
  onSelect: (model: AvailableModel) => void;
  disabled?: boolean;
}

const STORAGE_KEY = 'arcgpt.selectedModel';

/**
 * Reads the remembered choice.
 *
 * The selection is persisted because it is a property of the *user*, not of a
 * conversation: someone who prefers the larger coder model should not have to
 * reselect it on every new chat. A stored id that the current catalogue no
 * longer contains is ignored rather than honoured, so removing a model from the
 * backend cannot leave the selector pointing at nothing.
 */
export function readStoredModelId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    // Private mode, or storage disabled. Fall back to the backend default.
    return '';
  }
}

function storeModelId(id: string): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence is a convenience; never let it break the control.
  }
}

/**
 * Model picker for the ArcGPT chat.
 *
 * A dropdown rather than a toggle, because the list is a real list: two engines
 * today, and adding a third is a backend change only. Each entry shows the
 * model and the server behind it, because "Qwen3-Coder 30B" does not tell the
 * user that it is being served by LM Studio on port 1234 while the other is
 * served by Ollama.
 *
 * An engine that is not running is shown, greyed, with the reason. Hiding it
 * would make the selector lie by omission — the user would not know the option
 * exists, or why it cannot be picked. It stays disabled, and choosing it is
 * impossible.
 *
 * This control chooses a *language model and nothing else*. It cannot reach the
 * database, the credentials, the SQL validator or any permission: the backend
 * resolves the id to a model and nothing more, so the whole guardrail chain is
 * identical whichever entry is used.
 */
export function ModelSelector({ models, selectedId, onSelect, disabled = false }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const selected = useMemo(
    () => models.find(model => model.id === selectedId && model.available) ?? null,
    [models, selectedId]
  );

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // A pointer press outside dismisses the menu, on `pointerdown` so it closes in
  // the same gesture as the click that landed elsewhere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  /**
   * A model that went offline between turns must not stay selected: the next
   * question would fail with a provider error. Falling back to the first
   * available model keeps the control truthful about what will answer.
   */
  useEffect(() => {
    if (selected || models.length === 0) return;
    const fallback = models.find(model => model.available);
    if (fallback) onSelect(fallback);
  }, [models, onSelect, selected]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('.arc-model-item:not(:disabled)') ?? []
    );
    if (items.length === 0) return;

    const currentIndex = items.findIndex(item => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? step > 0
          ? 0
          : items.length - 1
        : (currentIndex + step + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const openMenu = () => {
    setOpen(true);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('.arc-model-item:not(:disabled)')?.focus();
    });
  };

  const choose = (model: AvailableModel) => {
    if (!model.available) return;
    onSelect(model);
    storeModelId(model.id);
    close(true);
  };

  const label = selected?.name || 'Select a model';
  const isEmpty = models.length === 0;

  return (
    <div
      className="arc-model"
      ref={containerRef}
      // Tabbing past the last item must not leave the menu open behind the user.
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        className="arc-model-trigger"
        type="button"
        onClick={() => (open ? close() : openMenu())}
        disabled={disabled || isEmpty}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={selected ? `Answering with ${selected.name} on ${selected.providerLabel}` : 'Choose the model that answers your questions'}
      >
        <Cpu size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="arc-model-trigger-label">{label}</span>
        <ChevronDown
          className="arc-model-caret"
          size={12}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="arc-model-menu"
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Available models"
          onKeyDown={moveFocus}
        >
          {models.map(model => {
            const isSelected = model.id === selectedId;
            return (
              <button
                key={`${model.provider}-${model.id}`}
                className="arc-model-item"
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                disabled={!model.available}
                onClick={() => choose(model)}
              >
                <span className="arc-model-item-icon" aria-hidden="true">
                  {isSelected ? (
                    <Check size={13} strokeWidth={2.2} />
                  ) : (
                    <Cpu size={13} strokeWidth={1.8} />
                  )}
                </span>
                <span className="arc-model-item-text">
                  <span className="arc-model-item-label">{model.name}</span>
                  <span className="arc-model-item-hint">
                    {model.available
                      ? `${model.providerLabel} · ${model.id}`
                      : `${model.providerLabel} unavailable — ${model.detail || 'not running'}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}