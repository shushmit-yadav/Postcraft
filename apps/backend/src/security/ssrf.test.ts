import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isBlockedIp } from './ssrf.js';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', // IPv4-mapped forms of loopback / metadata
    '64:ff9b::7f00:1', // NAT64
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('assertSafeUrl', () => {
  const ok = (u: string) => expect(() => assertSafeUrl(new URL(u))).not.toThrow();
  const blocked = (u: string) => {
    try {
      assertSafeUrl(new URL(u));
    } catch (err) {
      expect((err as { code?: string }).code).toBe('URL_NOT_ALLOWED');
      return;
    }
    throw new Error(`expected ${u} to be blocked`);
  };

  it('allows normal public URLs', () => {
    ok('https://shop.example.com/products/mug');
    ok('http://example.com:80/x');
  });

  it('blocks non-http protocols, credentials and unusual ports', () => {
    blocked('file:///etc/passwd');
    blocked('ftp://example.com/');
    blocked('https://user:pass@example.com/');
    blocked('http://example.com:8080/');
    blocked('http://example.com:22/');
  });

  it('blocks internal hosts in all their spellings', () => {
    blocked('http://localhost/');
    blocked('http://api.localhost/');
    blocked('http://metadata.google.internal/');
    blocked('http://127.0.0.1/');
    blocked('http://2130706433/'); // decimal 127.0.0.1
    blocked('http://0x7f.1/'); // hex shorthand
    blocked('http://017700000001/'); // octal
    blocked('http://[::1]/');
    blocked('http://[::ffff:127.0.0.1]/');
    blocked('http://169.254.169.254/latest/meta-data/');
  });
});
