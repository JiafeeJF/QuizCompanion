import { randomBytes } from 'node:crypto';
const testKey = randomBytes(32).toString('hex');
import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidMobileAdminKey } from './src/mobileAdminAccess.js';

test('mobile admin access requires the configured long random key', () => {
  const previous = process.env.ANDROID_ADMIN_PATH_KEY;
  process.env.ANDROID_ADMIN_PATH_KEY = testKey;
  try {
    assert.equal(isValidMobileAdminKey(testKey), true);
    assert.equal(isValidMobileAdminKey('a9Kx_7nQ2mP4vR8sT6wY3zC5bD1fG0hK'), false);
    assert.equal(isValidMobileAdminKey('short'), false);
  } finally {
    if (previous === undefined) delete process.env.ANDROID_ADMIN_PATH_KEY;
    else process.env.ANDROID_ADMIN_PATH_KEY = previous;
  }
});

test('mobile admin access stays disabled when no server key is configured', () => {
  const previous = process.env.ANDROID_ADMIN_PATH_KEY;
  delete process.env.ANDROID_ADMIN_PATH_KEY;
  try {
    assert.equal(isValidMobileAdminKey(testKey), false);
  } finally {
    if (previous !== undefined) process.env.ANDROID_ADMIN_PATH_KEY = previous;
  }
});
