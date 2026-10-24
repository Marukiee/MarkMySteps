import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import {
  ImmichTargetNotAllowedError,
  isAllowedHost,
  isPublicAddress,
  normalizeHost,
} from './immich-url-policy';

export interface GuardedFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Responses to these carry no body, and `new Response(stream, …)` refuses to. */
const BODYLESS = new Set([101, 204, 205, 304]);

/**
 * `fetch`, except that it refuses to connect to a private address (see
 * immich-url-policy.ts for why).
 *
 * The refusal is made at the moment of connecting, on the address that is
 * actually about to be used, and not on an earlier lookup of the same name.
 * `fetch` cannot do that: it resolves the hostname itself, so a name that
 * answered with a public address when it was checked can answer with an
 * internal one when it is used. Redirects are not followed — an Immich API
 * endpoint never sends one — so a 3xx comes back as a plain not-ok response.
 */
export function guardedFetch(url: URL, init: GuardedFetchInit = {}): Promise<Response> {
  const host = normalizeHost(url.hostname);

  // An IP literal never goes through a lookup, so it has to be judged here.
  if (isIP(host) !== 0 && !isAllowedHost(host) && !isPublicAddress(host)) {
    return Promise.reject(new ImmichTargetNotAllowedError(host));
  }

  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const req = send(
      url,
      {
        method: init.method ?? 'GET',
        headers: init.headers,
        signal: init.signal,
        lookup: guardedLookup,
      },
      (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
          else if (value !== undefined) headers.set(name, value);
        }
        const status = res.statusCode ?? 502;
        if (BODYLESS.has(status)) {
          res.resume();
          resolve(new Response(null, { status, statusText: res.statusMessage, headers }));
          return;
        }
        resolve(
          new Response(Readable.toWeb(res) as unknown as ReadableStream, {
            status,
            statusText: res.statusMessage,
            headers,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });
}

/**
 * Resolves like the default, then drops the connection if any answer is a
 * private address — unless the operator allowed this very name.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    if (!isAllowedHost(hostname) && list.some(({ address }) => !isPublicAddress(address))) {
      const refused: NodeJS.ErrnoException = new ImmichTargetNotAllowedError(
        normalizeHost(hostname),
      );
      refused.code = 'ECONNREFUSED';
      return callback(refused, '', 0);
    }
    if (options.all) return callback(null, list);
    const first = list[0];
    if (!first) return callback(new Error(`No address for ${hostname}`), '', 0);
    return callback(null, first.address, first.family);
  });
};
