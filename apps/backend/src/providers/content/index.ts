import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { ClaudeProvider } from './claude.js';
import { MockProvider } from './mock.js';
import type { ContentProvider } from './types.js';

// Claude when a key is configured, otherwise the deterministic mock (no key needed to run the app).
// maxRetries 1: pg-boss already retries the whole step with backoff.
const provider: ContentProvider = config.ANTHROPIC_API_KEY
  ? new ClaudeProvider(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 }), config.ANTHROPIC_MODEL)
  : new MockProvider();

export function getContentProvider(): ContentProvider {
  return provider;
}

export type { ContentProvider } from './types.js';
