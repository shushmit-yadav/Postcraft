import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch, type Response } from 'undici';
import { AppError } from '../lib/errors.js';

/**
 * SSRF protection for every outbound fetch of a user-supplied URL.
 *
 * Layers:
 *  1. Only http/https, standard ports, no credentials in the URL.
 *  2. IP-literal hosts are checked before connecting (the WHATWG URL parser
 *     already normalizes tricks like http://2130706433/ to 127.0.0.1).
 *  3. Hostnames are resolved by a custom DNS lookup inside the HTTP agent.
 *     The address we validate is the address we connect to, so a DNS
 *     rebinding attack can't swap in an internal IP after the check.
 *  4. Redirects are followed manually (max 3) and each hop is re-validated.
 *  5. Timeouts and a hard response size cap.
 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (can reach IPv4 internals)
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

const ALLOWED_PORTS = new Set(['', '80', '443']);
const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; PostcraftBot/0.1; product link preview)';

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    // IPv4-mapped / compatible IPv6 (::ffff:127.0.0.1) must be judged as IPv4.
    const mapped = /^(?:0*:)*(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip.replace(/^\[|\]$/g, ''));
    if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4');
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16);
      const lo = parseInt(hexMapped[2]!, 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
    }
    return blocked.check(ip, 'ipv6');
  }
  return true; // not an IP at all: refuse
}

const notAllowed = (reason: string) =>
  new AppError('URL_NOT_ALLOWED', 'That link points to an address we are not allowed to fetch.', {
    internalMessage: reason,
  });

/** Static checks on a URL before any network activity. Throws URL_NOT_ALLOWED. */
export function assertSafeUrl(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw notAllowed(`protocol ${url.protocol}`);
  if (url.username || url.password) throw notAllowed('credentials in URL');
  if (!ALLOWED_PORTS.has(url.port)) throw notAllowed(`port ${url.port}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedIp(host)) throw notAllowed(`blocked IP literal ${host}`);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw notAllowed(`blocked hostname ${host}`);
  }
}

class BlockedAddressError extends Error {
  readonly code = 'EBLOCKED';
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** DNS lookup used by the HTTP agent: resolves, then refuses if any address is internal. */
function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedIp(a.address));
    if (bad || list.length === 0) {
      return callback(new BlockedAddressError(`${hostname} resolves to ${bad?.address ?? 'nothing'}`), []);
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
}

const agent = new Agent({
  connect: { lookup: safeLookup as unknown as net.LookupFunction, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export interface SafeFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes: number;
  accept?: string;
}

export interface SafeFetchResult {
  url: URL;
  status: number;
  contentType: string;
  body: Buffer;
}

export async function safeFetch(input: string | URL, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  let url = new URL(input);
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 15_000)];
  if (opts.signal) signals.push(opts.signal);
  const signal = AbortSignal.any(signals);

  for (let hop = 0; ; hop++) {
    assertSafeUrl(url);
    let res: Response;
    try {
      res = await fetch(url, {
        dispatcher: agent,
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept ?? '*/*',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
    } catch (err) {
      throw mapNetworkError(err, url);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) {
        throw new AppError('TOO_MANY_REDIRECTS', 'That link redirects too many times.');
      }
      url = new URL(res.headers.get('location')!, url);
      continue;
    }

    const body = await readCapped(res, opts.maxBytes, signal);
    return { url, status: res.status, contentType: res.headers.get('content-type') ?? '', body };
  }
}

async function readCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new AppError('RESPONSE_TOO_LARGE', 'The linked page or file is too large to process.');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  if (!res.body) return Buffer.alloc(0);
  try {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        await res.body.cancel().catch(() => {});
        throw new AppError('RESPONSE_TOO_LARGE', 'The linked page or file is too large to process.');
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (signal.aborted) throw signal.reason;
    throw mapNetworkError(err, new URL(res.url));
  }
  return Buffer.concat(chunks);
}

function mapNetworkError(err: unknown, url: URL): Error {
  if (err instanceof AppError) return err;
  const cause = (err as { cause?: { code?: string; name?: string } })?.cause;
  const code = cause?.code ?? (err as { code?: string })?.code;
  const name = (err as Error)?.name;

  if (code === 'EBLOCKED' || cause instanceof BlockedAddressError) {
    return notAllowed(`${url.hostname} resolves to a blocked address`);
  }
  if (code === 'ENOTFOUND') {
    return new AppError('URL_UNREACHABLE', `We couldn't find the website "${url.hostname}". Check the link.`);
  }
  if (name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new AppError('FETCH_TIMEOUT', 'The website took too long to respond.', {
      retryable: true,
      cause: err,
    });
  }
  if (name === 'AbortError') return err as Error;
  return new AppError('FETCH_FAILED', 'We could not connect to that website.', {
    retryable: true,
    cause: err,
    internalMessage: `${code ?? name}: ${(err as Error)?.message}`,
  });
}
