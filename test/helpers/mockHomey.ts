import { vi } from 'vitest';

export interface MockHomey {
  settings: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    _store: Record<string, unknown>;
  };
  i18n: {
    getLanguage: () => string;
  };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export function createMockHomey(initial: Record<string, unknown> = {}, language = 'en'): MockHomey {
  const store: Record<string, unknown> = { ...initial };
  return {
    settings: {
      _store: store,
      get: vi.fn((key: string) => store[key] ?? null),
      set: vi.fn((key: string, value: unknown) => { store[key] = value; }),
    },
    i18n: {
      getLanguage: vi.fn(() => language),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
}
