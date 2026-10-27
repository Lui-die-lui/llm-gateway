// Toast and confirm modal shared by every page (the design's .toast / .modal-bg).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ConfirmSpec {
  title: string;
  body: string;
  ok: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (msg: string, tone?: 'ok' | 'error') => void;
  confirm: (spec: ConfirmSpec) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'error'; key: number } | null>(null);
  const [modal, setModal] = useState<(ConfirmSpec & { resolve: (v: boolean) => void }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const returnFocus = useRef<HTMLElement | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ msg, tone, key: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const confirm = useCallback((spec: ConfirmSpec) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    return new Promise<boolean>((resolve) => setModal({ ...spec, resolve }));
  }, []);

  const close = useCallback(
    (v: boolean) => {
      modal?.resolve(v);
      setModal(null);
      returnFocus.current?.focus?.();
    },
    [modal],
  );

  useEffect(() => {
    if (!modal) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Tab' && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>('button');
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, close]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ toast: showToast, confirm }), [showToast, confirm]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {toast && (
        <div key={toast.key} className={`toast${toast.tone === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
          {toast.tone === 'ok' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7FE0B5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 8v5M12 16.5v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
            </svg>
          )}
          <span>{toast.msg}</span>
        </div>
      )}
      {modal && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && close(false)}>
          <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
            <h2 id="confirm-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {modal.title}
            </h2>
            <p id="confirm-body" style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.65, color: 'var(--ink-2)' }}>
              {modal.body}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn" onClick={() => close(false)}>
                취소
              </button>
              <button ref={okRef} type="button" className={`btn ${modal.danger ? 'btn-d' : 'btn-p'}`} onClick={() => close(true)}>
                {modal.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback outside FeedbackProvider');
  return v;
}
