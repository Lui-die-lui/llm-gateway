// The console's dropdown. The browser's own <select> list cannot be styled (white box, blue highlight), so this draws the same
// pill button and a list in the console's glass style. It is a real combobox: keyboard (arrows, Home/End, Enter, Esc) and screen readers.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  value: T;
  onChange: (v: T) => void;
  options: readonly SelectOption<T>[];
  /** Accessible name (what the dropdown chooses). */
  label: string;
  disabled?: boolean;
  width?: number | string;
  title?: string;
}

const MENU_MAX = 280;

export function Select<T extends string | number>({ value, onChange, options, label, disabled, width, title }: Props<T>) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const selected = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);

  const openMenu = () => {
    if (disabled) return;
    setActive(selected >= 0 ? selected : 0);
    setOpen(true);
  };

  // Place the list under the button (above it when there is no room), at least as wide as the button. Closes on scroll or resize.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const need = Math.min(MENU_MAX, options.length * 36 + 12);
    const up = room < need + 12 && r.top > room;
    const w = Math.max(r.width, 160);
    setPos({ left: Math.min(r.left, window.innerWidth - w - 8), width: w, ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const shut = () => close(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }); // (not in every test environment)
  }, [open, active, pos]);

  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    const go = (next: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(options.length - 1, next)));
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') go(active + 1);
    else if (e.key === 'ArrowUp') go(active - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    }
  };

  const current = selected >= 0 ? options[selected]?.label : '';
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="dd-btn"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        title={title}
        style={width !== undefined ? { width } : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKey}
      >
        <span className="dd-val">{current}</span>
        <svg className="dd-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={menu} id={`${id}-list`} role="listbox" aria-label={label} className="dd-menu" style={{ position: 'fixed', zIndex: 1000, left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width }}>
            {options.map((o, i) => (
              <div key={String(o.value)} id={`${id}-${i}`} data-i={i} role="option" aria-selected={i === selected} className={`dd-opt${i === active ? ' act' : ''}${i === selected ? ' sel' : ''}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                <span>{o.label}</span>
                {i === selected && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
