import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetMockDb } from '../mocks/db';

// jsdom has no layout; ConsoleLayout scrolls to top on navigation.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  resetMockDb();
});
