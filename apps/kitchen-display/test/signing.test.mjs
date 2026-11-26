import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { base64, canonicalRequest, p1363ToDer, signedHeaders } from '../src/signing.mjs';

test('browser signatures interoperate with the existing DER verifier and bind the query and body', async () => {
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const identity = {deviceId:'display-fixture',privateKey:pair.privateKey};
  const path = '/v1/display/publications/output-fixture/content';
  const headers = await signedHeaders(identity,'GET',path);
  const canonical = await canonicalRequest('GET',path,headers['X-Hardy-Timestamp'],headers['X-Hardy-Nonce']);
  const publicKey = createPublicKey({key:Buffer.from(await crypto.subtle.exportKey('spki',pair.publicKey)),format:'der',type:'spki'});
  const signature = Buffer.from(headers['X-Hardy-Signature'],'base64');
  assert.equal(verify('sha256',Buffer.from(canonical),publicKey,signature),true);
  assert.equal(verify('sha256',Buffer.from(canonical.replace('output-fixture','other-output')),publicKey,signature),false);
  await assert.rejects(canonicalRequest('GET','/v1/profiles/me','1','nonce'),/display_path/);
  assert.notEqual(await canonicalRequest('GET','/v1/display/snapshot?a=1','1','nonce'),await canonicalRequest('GET','/v1/display/snapshot?a=2','1','nonce'));
  assert.notEqual(await canonicalRequest('POST','/v1/display/enrollment/claim','1','nonce','{}'),await canonicalRequest('POST','/v1/display/enrollment/claim','1','nonce','{"code":"different"}'));
});

test('DER preserves unsigned P-256 integer padding and trims leading zeros', () => {
  const signature = new Uint8Array(64); signature[0]=0x80; signature[63]=1;
  const der = p1363ToDer(signature);
  assert.equal(der[0],0x30); assert.equal(der[3],33); assert.equal(der[4],0); assert.equal(der[5],0x80);
  assert.deepEqual(Array.from(der.slice(-3)),[2,1,1]);
  assert.throws(() => p1363ToDer(new Uint8Array(63)),/signature_format/);
  assert.equal(base64(new Uint8Array([0,128,255])),'AID/');
});
