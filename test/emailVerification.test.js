import test from 'node:test';
import assert from 'node:assert/strict';
import { generateVerificationCode, hashVerificationCode, isStrongPassword } from '../src/utils/emailVerification.js';
import { isRequestCatalogItemAvailable, isRoleAllowed } from '../src/utils/documentCatalog.js';
import { requireAdmin } from '../src/middleware/auth.middleware.js';
import { validateStudentIdNumber } from '../src/utils/studentId.js';
import { matchesImageSignature } from '../src/utils/imageSignature.js';

test('verification codes are six digits, including leading zeroes', () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.match(generateVerificationCode(), /^\d{6}$/);
  }
});

test('verification codes are stored as keyed hashes, not raw values', () => {
  process.env.JWT_SECRET = 'test-secret-for-verification';
  const codeHash = hashVerificationCode('012345');

  assert.match(codeHash, /^[a-f0-9]{64}$/);
  assert.notEqual(codeHash, '012345');
  assert.equal(hashVerificationCode('012345'), codeHash);
  assert.notEqual(hashVerificationCode('012346'), codeHash);
});

test('password policy matches the signup UI requirements', () => {
  assert.equal(isStrongPassword('GoodPass1!'), true);
  assert.equal(isStrongPassword('lowercase1!'), false);
  assert.equal(isStrongPassword('NoNumber!'), false);
  assert.equal(isStrongPassword('Short1!'), false);
});

test('catalog role policy matches roles without case sensitivity', () => {
  assert.equal(isRoleAllowed(['student'], 'student'), true);
  assert.equal(isRoleAllowed(['Student'], 'STUDENT'), true);
  assert.equal(isRoleAllowed(['alumni'], 'student'), false);
  assert.equal(isRoleAllowed([], 'student'), false);
});

test('admin authorization rejects student tokens', () => {
  let statusCode;
  let responseBody;
  let passed = false;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  requireAdmin({ user: { role: 'student', type: 'student' } }, response, () => {
    passed = true;
  });

  assert.equal(passed, false);
  assert.equal(statusCode, 403);
  assert.match(responseBody.message, /Admin privileges required/);
});

test('admin authorization permits admin tokens', () => {
  let passed = false;

  requireAdmin({ user: { role: 'admin' } }, {}, () => {
    passed = true;
  });

  assert.equal(passed, true);
});

test('student IDs require exactly nine string digits and preserve leading zeroes', () => {
  assert.equal(validateStudentIdNumber('012345678'), '012345678');
  assert.equal(validateStudentIdNumber('12345678'), null);
  assert.equal(validateStudentIdNumber('1234567890'), null);
  assert.equal(validateStudentIdNumber('12345abcd'), null);
  assert.equal(validateStudentIdNumber('123-45678'), null);
  assert.equal(validateStudentIdNumber(' 12345678'), null);
  assert.equal(validateStudentIdNumber(123456789), null);
});

test('receipt image validation checks content signatures, not only MIME labels', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');

  assert.equal(matchesImageSignature(jpeg, 'image/jpeg'), true);
  assert.equal(matchesImageSignature(png, 'image/png'), true);
  assert.equal(matchesImageSignature(webp, 'image/webp'), true);
  assert.equal(matchesImageSignature(jpeg, 'image/png'), false);
  assert.equal(matchesImageSignature(Buffer.from('not an image'), 'image/jpeg'), false);
  assert.equal(matchesImageSignature(null, 'image/jpeg'), false);
});

test('archived or inactive catalog entries are unavailable for new requests', () => {
  assert.equal(isRequestCatalogItemAvailable({ active: true, archived: false }), true);
  assert.equal(isRequestCatalogItemAvailable({ active: false, archived: false }), false);
  assert.equal(isRequestCatalogItemAvailable({ active: true, archived: true }), false);
  assert.equal(isRequestCatalogItemAvailable({}), true);
});