import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { AuthProvider } from '../features/auth';
import { FeedbackProvider } from '../features/feedback';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // 4xx will not fix itself; retry only network hiccups and 5xx once.
        retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
    },
  });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [qc] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={qc}>
      <FeedbackProvider>
        <AuthProvider>{children}</AuthProvider>
      </FeedbackProvider>
    </QueryClientProvider>
  );
}
