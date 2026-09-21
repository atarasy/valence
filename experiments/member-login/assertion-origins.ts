import { validateAndroidAppOrigins } from '../../engine/src/shared/assertion-origins.js';

export const androidAssertionOrigins = validateAndroidAppOrigins;

export function acceptedAssertionOrigins(webOrigin: string, androidOrigins: unknown): string[] {
  return [webOrigin, ...androidAssertionOrigins(androidOrigins)];
}
