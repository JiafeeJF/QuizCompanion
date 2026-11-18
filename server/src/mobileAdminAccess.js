import crypto from 'crypto';

const MIN_KEY_LENGTH = 24;
const MAX_KEY_LENGTH = 128;

export function configuredMobileAdminKey() {
  return String(process.env.ANDROID_ADMIN_PATH_KEY || '').trim();
}

/** Constant-time comparison prevents leaking the configured path key through timing. */
export function isValidMobileAdminKey(candidate) {
  const expected = configuredMobileAdminKey();
  const supplied = String(candidate || '').trim();
  if (expected.length < MIN_KEY_LENGTH || expected.length > MAX_KEY_LENGTH) return false;
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
