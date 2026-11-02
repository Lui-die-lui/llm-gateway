// How long an approved exception still lasts, shown to the person who asked. Ticks by itself so the number stays right
// while the page is open; the approval itself is decided and enforced by the gateway, this only tells the person.
import { useEffect, useState } from 'react';
import { formatRemaining, grantTime } from '../api/exceptions';
import type { PortalRequest } from '../api/consoleTypes';

const hm = (epochSeconds: number) => {
  const d = new Date(epochSeconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function GrantTime({ request }: { request: PortalRequest }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const g = grantTime(request, now);
  if (!g) return null;
  const tone = g.kind === 'running' || g.kind === 'once-open' ? 'rgba(16,185,129,.12)' : 'rgba(15,26,43,.06)';
  const color = g.kind === 'running' || g.kind === 'once-open' ? '#047857' : '#4A5568';
  return (
    <div data-testid="grant-time" style={{ padding: '10px 12px', borderRadius: 12, background: tone, color, fontSize: 12.5, lineHeight: 1.6 }}>
      {g.kind === 'running' && (
        <>
          <b>남은 시간 {formatRemaining(g.remainingSeconds)}</b> · {hm(g.endsAt)}까지 원문 전송이 허용돼요
        </>
      )}
      {g.kind === 'once-open' && <b>1회 허용 · 아직 쓰지 않았어요</b>}
      {g.kind === 'once-used' && <>1회 허용을 사용했어요 · 다시 보호돼요</>}
      {g.kind === 'ended' && <>허용 기간이 끝났어요 · 다시 보호돼요</>}
    </div>
  );
}
