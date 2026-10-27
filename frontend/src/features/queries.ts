// Query keys and the hooks shared by more than one page.
import { useQuery } from '@tanstack/react-query';
import { consoleApi } from '../api/console';
import { gateway } from '../api/gateway';

export const qk = {
  health: ['gw', 'health'] as const,
  config: ['gw', 'config'] as const,
  industries: ['gw', 'industries'] as const,
  evalReport: ['gw', 'eval'] as const,
  summary: (since: number) => ['gw', 'summary', since] as const,
  timeseries: (bucket: string, since: number) => ['gw', 'timeseries', bucket, since] as const,
  audit: (q: object) => ['gw', 'audit', q] as const,
  company: ['mock', 'company'] as const,
  joins: ['mock', 'joins'] as const,
  members: ['mock', 'members'] as const,
  policy: ['mock', 'policy'] as const,
  basicRules: ['mock', 'basicRules'] as const,
  exceptions: ['mock', 'exceptions'] as const,
  adminLog: ['mock', 'adminLog'] as const,
  candidates: ['mock', 'candidates'] as const,
  anomalies: ['mock', 'anomalies'] as const,
  minutes: ['mock', 'minutes'] as const,
  heatmap: ['mock', 'heatmap'] as const,
  schedules: ['mock', 'schedules'] as const,
  settings: ['mock', 'settings'] as const,
  portal: (part: string) => ['mock', 'portal', part] as const,
};

export const useHealth = () =>
  useQuery({ queryKey: qk.health, queryFn: gateway.health, refetchInterval: 30_000, retry: false });

export const useCompany = () => useQuery({ queryKey: qk.company, queryFn: consoleApi.company });
export const useJoinRequests = () => useQuery({ queryKey: qk.joins, queryFn: consoleApi.joinRequests });
export const useExceptions = () => useQuery({ queryKey: qk.exceptions, queryFn: consoleApi.exceptions });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: consoleApi.settings });

/** Counts for the sidebar badges and overview alerts. */
export function usePendingCounts() {
  const joins = useJoinRequests();
  const exc = useExceptions();
  return {
    joins: joins.data?.filter((j) => !j.decision).length ?? 0,
    joinsWarn: joins.data?.filter((j) => !j.decision && j.warn).length ?? 0,
    exceptions: exc.data?.filter((e) => e.status === 'pending').length ?? 0,
    exceptionsUrgent: exc.data?.filter((e) => e.status === 'pending' && e.slaUrgent > 0).length ?? 0,
  };
}
