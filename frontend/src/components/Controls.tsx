import { useId, type ReactNode } from 'react';

/** Segmented control (.seg). Options are buttons with aria-pressed. */
export function Seg<T extends string | number>({
  label,
  options,
  value,
  onChange,
  mono,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  mono?: boolean;
}) {
  return (
    <div className={`seg${mono ? ' mono-seg' : ''}`} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** On/off switch (.tog). aria-label is required because the control has no visible text. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="tog" aria-pressed={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** "!" help bubble. Opens on hover and on keyboard focus. */
export function Help({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="help">
      <button type="button" className="hi" aria-label={label} aria-describedby={id}>
        !
      </button>
      <span className="hp" role="tooltip" id={id}>
        <b>{title}</b>
        {children}
      </span>
    </span>
  );
}

/** Small "예시 값" marker for numbers that come from mocks, not from the gateway. */
export function MockBadge({ text = '예시 값' }: { text?: string }) {
  return (
    <span className="badge b-muted" title="서버에 아직 없는 데이터라 예시 값으로 보여요 (frontend/README.md 참고)">
      {text}
    </span>
  );
}
