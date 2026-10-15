// A development-only file store for uploaded Company CVs: files are written
// to a local folder and served back through an authenticated route.
//
// This is NOT the production storage architecture. The task guide does not
// say where uploaded CVs must be kept, so no production provider is chosen
// here. A real provider is added behind this same two-function interface
// (save, read) without touching the callers.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = fileURLToPath(new URL('../../.dev-storage', import.meta.url));

// The file types a candidate may upload, with the extension each is stored as.
export const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const NAME_FORMAT = /^[0-9a-f]{32}\.(pdf|doc|docx)$/;

export function createDevStorage({ dir } = {}) {
  const root = dir || DEFAULT_DIR;

  return {
    kind: 'development-local',

    // Stores the bytes and returns the name they can be read back by.
    async save({ buffer, contentType }) {
      const extension = ALLOWED_TYPES[contentType];
      if (!extension) throw new Error('File type not allowed.');
      await mkdir(root, { recursive: true });
      const name = `${randomBytes(16).toString('hex')}${extension}`;
      await writeFile(path.join(root, name), buffer);
      return { name };
    },

    // Returns the stored bytes, or null for an unknown or malformed name. The
    // name is checked against a strict pattern, so it can never be a path.
    async read(name) {
      if (!NAME_FORMAT.test(name)) return null;
      try {
        return await readFile(path.join(root, name));
      } catch {
        return null;
      }
    },
  };
}
