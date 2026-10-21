// A fake web for the browser-renderer tests: DNS is a stub and the HTTPS transport
// is a set of pages held in memory, so nothing leaves this computer. The real
// request rules (fetchSubresource) are applied on top, so a page that reaches for
// an internal address is refused exactly as in production.
//
// `site` maps "host/path" to { type, body, status, headers, delayMs }.
// `internal.example.test` resolves to a private address.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchSubresource } from '../../src/modules/cv-extraction/safeFetch.js';

export const PUBLIC_IP = '93.184.216.34';

export function fakeNetwork(site) {
  const requests = [];
  const resolve = async (hostname) => {
    if (hostname === 'internal.example.test') return [{ address: '10.0.0.5', family: 4 }];
    return [{ address: PUBLIC_IP, family: 4 }];
  };
  const transport = (options, onResponse) => {
    requests.push({
      host: options.host,
      hostname: options.headers.Host,
      path: options.path,
      headers: options.headers,
    });
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      const hit = site[`${options.headers.Host}${options.path}`];
      const res = new PassThrough();
      res.statusCode = hit ? (hit.status ?? 200) : 404;
      res.headers = { 'content-type': hit?.type ?? 'text/plain', ...(hit?.headers ?? {}) };
      setTimeout(() => {
        onResponse(res);
        res.end(hit?.body ?? 'not found');
      }, hit?.delayMs ?? 0);
    };
    return req;
  };
  const fetchThroughRules = (url, options) =>
    fetchSubresource(url, { ...options, resolve, transport, timeoutMs: 3000 });
  return { requests, fetchThroughRules };
}
