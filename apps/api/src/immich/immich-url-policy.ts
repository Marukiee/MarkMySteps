import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Where the server may send requests on a user's behalf.
 *
 * Everyone with an account enters the address of their own Immich server, and
 * this backend then fetches from it. Left open, that is a way to make the
 * server call things it can reach and the visitor cannot: the router, the
 * admin pages of other containers, whatever listens on the LAN. So addresses
 * on private networks are refused, unless the person running this server has
 * named them in IMMICH_ALLOWED_HOSTS (for example the LAN address of their own
 * Immich). Public addresses need nothing.
 *
 * The check runs when the address is saved, and again every time a connection
 * is made (see guarded-fetch.ts): a hostname can be pointed at a public address
 * for the first and a private one for the second.
 */

/** Everything that is not a routable address on the public internet. */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT — and Tailscale
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private — and Docker's networks
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64: carries an IPv4 address inside
  ['2001::', 32], // Teredo: so does this
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

export class ImmichTargetNotAllowedError extends Error {
  constructor(host: string) {
    super(`Requests to "${host}" are not allowed (private or reserved address)`);
    this.name = 'ImmichTargetNotAllowedError';
  }
}

/** True when `address` is an IP literal that is reachable on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // ::ffff:10.0.0.1 is an IPv4 address in IPv6 clothes; judge the address inside.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    if (mappedHex) {
      const high = parseInt(mappedHex[1]!, 16);
      const low = parseInt(mappedHex[2]!, 16);
      return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return !NON_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** `[::1]` → `::1`, `Example.COM.` → `example.com`. */
export function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

/** Hosts the operator has explicitly allowed to be on a private network. */
export function allowedPrivateHosts(): Set<string> {
  const raw = process.env.IMMICH_ALLOWED_HOSTS ?? '';
  return new Set(
    raw
      .split(',')
      .map((entry) => normalizeHost(entry.trim()))
      .filter((entry) => entry.length > 0),
  );
}

export function isAllowedHost(hostname: string): boolean {
  return allowedPrivateHosts().has(normalizeHost(hostname));
}

/**
 * Throws unless a request to this URL is acceptable.
 *
 * Hostnames are resolved and every address they resolve to has to be public:
 * one private answer among several is enough to refuse.
 */
export async function assertImmichUrlAllowed(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImmichTargetNotAllowedError(url.protocol);
  }
  // A URL can carry a login (http://user:pass@host). Nothing here needs one.
  if (url.username || url.password) {
    throw new ImmichTargetNotAllowedError('a URL with credentials');
  }

  const host = normalizeHost(url.hostname);
  if (isAllowedHost(host)) return url;

  if (isIP(host) !== 0) {
    if (!isPublicAddress(host)) throw new ImmichTargetNotAllowedError(host);
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    // Not resolving is the connection's problem to report, not a policy matter.
    return url;
  }
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ImmichTargetNotAllowedError(host);
  }
  return url;
}
