// Query keys and the hooks shared by more than one page.
import { useQuery } from '@tanstack/react-query';
import { consoleApi } from '../api/console';
import { gateway } from '../api/gateway';

export const qk = {
  health: ['gw', 'health'] as const,
  config: ['gw', 'config'] as const,
  industries: ['gw', 'industries'] as const,
  builtinRules: ['gw', 'builtinRules'] as const,
  evalReport: ['gw', 'eval'] as const,
  summary: (since: number) => ['gw', 'summary', since] as const,
  timeseries: (bucket: string, since: number) => ['gw', 'timeseries', bucket, since] as const,
  audit: (q: object) => ['gw', 'audit', q] as const,
  company: ['mock', 'company'] as const,
  members: ['mock', 'members'] as const,
  policy: ['gw', 'policy'] as const,
  basicRules: ['gw', 'basicRules'] as const,
  exceptions: ['mock', 'exceptions'] as const,
  adminLog: ['mock', 'adminLog'] as const,
  candidates: ['mock', 'candidates'] as const,
  anomalies: ['mock', 'anomalies'] as const,
  minutes: ['mock', 'minutes'] as const,
  heatmap: ['mock', 'heatmap'] as const,
  schedules: ['mock', 'schedules'] as const,
  serverSettings: ['gw', 'serverSettings'] as const,
  portal: (part: string) => ['mock', 'portal', part] as const,
};

export const useHealth = () =>
  useQuery({ queryKey: qk.health, queryFn: gateway.health, refetchInterval: 30_000, retry: false });

export const useExceptions = () => useQuery({ queryKey: qk.exceptions, queryFn: consoleApi.exceptions, refetchInterval: 5_000 });
export const useServerSettings = () => useQuery({ queryKey: qk.serverSettings, queryFn: consoleApi.serverSettings, retry: false });

export const useAnomalies = () => useQuery({ queryKey: qk.anomalies, queryFn: consoleApi.anomalies, refetchInterval: 15_000 });

/** Counts for the sidebar badge and the overview: real exception requests waiting, and anomalies nobody has acknowledged. */
export function usePendingCounts() {
  const exc = useExceptions();
  const anomalies = useAnomalies();
  return {
    exceptions: exc.data?.filter((e) => e.status === 'pending').length ?? 0,
    anomalies: anomalies.data?.filter((a) => !a.acked).length ?? 0,
  };
}
