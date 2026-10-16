import test from 'node:test';
import assert from 'node:assert/strict';
import { readVerifyLink, safeNext, buildVerifyLink, verifyErrorMessage } from '../src/verify-utils.js';

test('reads an iPOS verification link like the MongoDB one', () => {
  const l = readVerifyLink('?token_hash=pkce_abc123&type=signup&n=%2Faccount%2Fregister%2Fsuccess&username=owner%40shop.co.zm');
  assert.deepEqual([l.tokenHash, l.type, l.next, l.username], ['pkce_abc123', 'signup', '/account/register/success', 'owner@shop.co.zm']);
});

test('defaults by link type', () => {
  assert.equal(readVerifyLink('?token_hash=x').next, '/account/register/success');
  assert.equal(readVerifyLink('?token_hash=x&type=recovery').next, '/reset-password');
  assert.equal(readVerifyLink('?token_hash=x&type=invite').next, '/reset-password');
  assert.equal(readVerifyLink('?token_hash=x&type=bogus').type, 'signup');
});

test('never sends people to another website', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/javascript:alert(1)', '%2F%2Fevil.example', '/%0d%0aSet-Cookie'])
    assert.equal(safeNext(bad, 'signup'), '/account/register/success', bad);
  assert.equal(safeNext('/dashboard?tab=1'), '/dashboard?tab=1');
});

test('keeps a plus sign in email addresses', () => {
  assert.equal(readVerifyLink('?token_hash=x&username=ann+shop@gmail.com').username, 'ann+shop@gmail.com');
});

test('reads errors Supabase puts in the link', () => {
  const l = readVerifyLink('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(l.errorCode, 'otp_expired');
  assert.match(verifyErrorMessage({ message: l.error, code: l.errorCode }), /expired/);
});

test('builds the same link the email template creates', () => {
  const url = buildVerifyLink('https://ipossystem.vercel.app', { tokenHash: 'abc', username: 'a@b.co' });
  assert.equal(url, 'https://ipossystem.vercel.app/account/email/verify?token_hash=abc&type=signup&n=%2Faccount%2Fregister%2Fsuccess&username=a%40b.co');
  assert.deepEqual(readVerifyLink(new URL(url).search).tokenHash, 'abc');
});
