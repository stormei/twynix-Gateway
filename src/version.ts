export const APP_VERSION = process.env.APP_VERSION || '0.2.0-dev';
export const BUILD_SHA = process.env.BUILD_SHA || 'local';

export function versionInfo() {
  return {
    version: APP_VERSION,
    buildSha: BUILD_SHA,
    label: `${APP_VERSION}+${BUILD_SHA}`
  };
}
