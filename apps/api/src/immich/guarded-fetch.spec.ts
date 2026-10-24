import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { guardedFetch } from './guarded-fetch';

/** A stand-in for an Immich server (or for a service that is none of Immich's business). */
function startServer(): Promise<{ server: Server; port: number; seen: { path?: string; headers?: Record<string, unknown>; body?: string }[] }> {
  const seen: { path?: string; headers?: Record<string, unknown>; body?: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ path: req.url, headers: req.headers, body });
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      } else if (req.url === '/empty') {
        res.writeHead(204).end();
      } else if (req.url === '/range') {
        res.writeHead(206, { 'content-range': 'bytes 0-3/10', 'content-type': 'video/mp4' });
        res.end('abcd');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, method: req.method, body }));
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, seen }),
    ),
  );
}

describe('guardedFetch', () => {
  const original = process.env.IMMICH_ALLOWED_HOSTS;
  let server: Server;
  let port: number;
  let seen: { path?: string; headers?: Record<string, unknown>; body?: string }[];

  beforeAll(async () => {
    ({ server, port, seen } = await startServer());
  });
  afterAll(() => server.close());
  beforeEach(() => {
    seen.length = 0;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.IMMICH_ALLOWED_HOSTS;
    else process.env.IMMICH_ALLOWED_HOSTS = original;
  });

  describe('when the address is not allowed', () => {
    it('refuses an IP literal without sending anything', async () => {
      await expect(guardedFetch(new URL(`http://127.0.0.1:${port}/`))).rejects.toThrow(
        /not allowed/,
      );
      expect(seen).toHaveLength(0);
    });

    it('refuses a name that resolves to a private address, at connect time', async () => {
      // `localhost` is the stand-in for a hostname an attacker points at
      // something internal after it has passed the check made on saving.
      await expect(guardedFetch(new URL(`http://localhost:${port}/`))).rejects.toThrow(
        /not allowed/,
      );
      expect(seen).toHaveLength(0);
    });

    it('refuses IPv4-mapped IPv6 literals', async () => {
      await expect(guardedFetch(new URL(`http://[::ffff:127.0.0.1]:${port}/`))).rejects.toThrow(
        /not allowed/,
      );
      expect(seen).toHaveLength(0);
    });
  });

  describe('when the operator allowed the host', () => {
    beforeEach(() => {
      process.env.IMMICH_ALLOWED_HOSTS = '127.0.0.1,localhost';
    });

    it('does what fetch does: method, headers, body, JSON response', async () => {
      const res = await guardedFetch(new URL(`http://127.0.0.1:${port}/api/search`), {
        method: 'POST',
        headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(await res.json()).toEqual({ ok: true, method: 'POST', body: '{"a":1}' });
      expect(seen[0]?.headers?.['x-api-key']).toBe('k');
    });

    it('also reaches an allowed hostname', async () => {
      const res = await guardedFetch(new URL(`http://localhost:${port}/x`));
      expect(res.status).toBe(200);
    });

    it('passes a partial response through, for seeking in video', async () => {
      const res = await guardedFetch(new URL(`http://127.0.0.1:${port}/range`), {
        headers: { range: 'bytes=0-3' },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 0-3/10');
      expect(seen[0]?.headers?.range).toBe('bytes=0-3');
      expect(await res.text()).toBe('abcd');
    });

    it('does not follow redirects: a 3xx is simply not ok', async () => {
      const res = await guardedFetch(new URL(`http://127.0.0.1:${port}/redirect`));
      expect(res.ok).toBe(false);
      expect(res.status).toBe(302);
      expect(seen).toHaveLength(1);
    });

    it('copes with a response that has no body', async () => {
      const res = await guardedFetch(new URL(`http://127.0.0.1:${port}/empty`));
      expect(res.status).toBe(204);
    });

    it('honours the abort signal', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        guardedFetch(new URL(`http://127.0.0.1:${port}/`), { signal: controller.signal }),
      ).rejects.toThrow();
    });
  });
});
