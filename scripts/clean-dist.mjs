import { rm } from 'node:fs/promises';
import path from 'node:path';

const target = path.resolve('dist');
if (path.basename(target) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build directory: ${target}`);
}
await rm(target, { recursive: true, force: true });
