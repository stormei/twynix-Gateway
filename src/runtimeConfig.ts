import { EdgeConfig } from './types.js';

export function configRestartScope(current: EdgeConfig, next: EdgeConfig): 'hot' | 'full' {
  const scrub = (cfg: EdgeConfig) => {
    const normalized: any = {
      ...cfg,
      opcua: { ...cfg.opcua },
      mapping: undefined,
      writeMinIntervalMs: undefined
    };
    delete normalized.version;
    delete normalized.opcua.mappings;
    return normalized;
  };
  return JSON.stringify(scrub(current)) === JSON.stringify(scrub(next)) ? 'hot' : 'full';
}
