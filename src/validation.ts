import { validateConfig as validateRuntimeConfig } from './config.js';
import { EdgeConfig } from './types.js';

export function validateConfig(cfg: EdgeConfig) {
  validateRuntimeConfig(cfg);
}
