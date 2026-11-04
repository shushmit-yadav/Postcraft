import { MockProvider } from './mock.js';
import type { ContentProvider } from './types.js';

const mock = new MockProvider();

/** Claude is wired in on Day 3; until then (and whenever no API key is set) the mock is used. */
export function getContentProvider(): ContentProvider {
  return mock;
}

export type { ContentProvider } from './types.js';
