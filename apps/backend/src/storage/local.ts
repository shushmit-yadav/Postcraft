import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertValidKey, type StorageProvider } from './provider.js';

export class LocalStorage implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Storage key escapes root');
    return full;
  }

  async put(key: string, body: Buffer | Readable) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // Write to a temp file then rename, so readers never see a half-written file.
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    try {
      if (Buffer.isBuffer(body)) await fs.writeFile(tmp, body);
      else await pipeline(body, createWriteStream(tmp));
      await fs.rename(tmp, full);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    const { size } = await fs.stat(full);
    return { bytes: size };
  }

  read(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.resolve(key), range);
  }

  async stat(key: string) {
    try {
      const s = await fs.stat(this.resolve(key));
      return { bytes: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }

  async localPath(key: string) {
    return this.resolve(key);
  }
}
