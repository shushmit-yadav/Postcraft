import { config } from '../config.js';
import { LocalStorage } from './local.js';
import type { StorageProvider } from './provider.js';

export const storage: StorageProvider = new LocalStorage(config.STORAGE_DIR);
export type { StorageProvider } from './provider.js';
