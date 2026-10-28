import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetMockDb } from '../mocks/db';

// jsdom has no layout; ConsoleLayout scrolls to top on navigation.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// Node 22+ ships its own fetch Request, which rejects the AbortSignal jsdom hands react-router on navigation
// ("Expected signal to be an instance of AbortSignal"). Tests never abort a navigation, so drop the signal.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init && 'signal' in init ? { ...init, signal: undefined } : init);
  }
} as typeof Request;

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  resetMockDb();
});
