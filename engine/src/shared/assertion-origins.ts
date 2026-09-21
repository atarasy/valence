const ANDROID_ORIGIN_PREFIX = 'android:apk-key-hash:';

/** Android WebAuthn origins are the canonical base64url SHA-256 signing-certificate digest. */
export function validateAndroidAppOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid Android assertion origins');
  const origins = value.map(origin => {
    if (typeof origin !== 'string' || !origin.startsWith(ANDROID_ORIGIN_PREFIX)) throw new Error('Invalid Android assertion origin');
    const digest = origin.slice(ANDROID_ORIGIN_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(digest) || Buffer.from(digest, 'base64url').length !== 32 || Buffer.from(digest, 'base64url').toString('base64url') !== digest) {
      throw new Error('Invalid Android assertion origin');
    }
    return origin;
  });
  if (new Set(origins).size !== origins.length || origins.some((origin, index) => index > 0 && origins[index - 1]! >= origin)) {
    throw new Error('Android assertion origins must be unique and sorted');
  }
  return origins;
}

export function acceptsAssertionOrigin(webOrigin: string, androidAppOrigins: readonly string[], actual: unknown): boolean {
  return typeof actual === 'string' && (actual === webOrigin || androidAppOrigins.includes(actual));
}
