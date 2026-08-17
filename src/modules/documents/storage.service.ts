import fs from 'fs/promises';
import path from 'path';
import { env } from '../../config/env.js';

export class StorageService {
  constructor() {
    // Ensure the storage directory exists
    fs.mkdir(env.STORAGE_PATH, { recursive: true }).catch(console.error);
  }

  /**
   * Generates an absolute path for a given storage key.
   */
  getAbsolutePath(storageKey: string): string {
    return path.join(env.STORAGE_PATH, storageKey);
  }

  /**
   * Deletes a file from storage.
   */
  async deleteFile(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.getAbsolutePath(storageKey));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /**
   * Reads a file from storage into a buffer.
   */
  async readFile(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.getAbsolutePath(storageKey));
  }
}

export const storageService = new StorageService();
