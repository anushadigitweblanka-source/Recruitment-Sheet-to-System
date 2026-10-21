// Fetches a CV document from a link HR pastes in, safely.
//
// The address is untrusted input, so the fetch is built to be unable to reach
// anything inside the network, whatever the link says:
//   - HTTPS only, default port only, no user name or password in the link.
//   - Only host names, never raw IP addresses.
//   - The name is resolved HERE, every address it resolves to must be public,
//     and the connection is then made to that exact checked address. The name
//     is never resolved a second time, so DNS rebinding cannot swap it.
//   - Redirects are refused. Following them safely would mean repeating all
//     of these checks for every hop; a direct document link does not need one.
//   - No cookies or credentials of this application are ever sent.
//   - A size limit and an overall time limit apply while downloading.
//   - The result must be a PDF, a Word file or an HTML page; the bytes decide,
//     not the content type the server claims. An HTML page is only read as
//     text: no script, style or other resource it names is ever fetched.
//
// Nothing here logs the link or the document. Errors carry a fixed reason
// code and a fixed message, never the address, so a link with secrets in it
// cannot leak through an error.

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { looksLikeHtml } from './htmlText.js';
import { MAX_BYTES, detectFormat } from './textExtractor.js';

export const FETCH_TIMEOUT_MS = 15_000;
const MAX_URL_LENGTH = 2000;

// Every address range that is not the public internet.
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including the cloud metadata address
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
]) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (can embed a private IPv4 address)
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
]) {
  blocked.addSubnet(net, bits, 'ipv6');
}

// True only for an address on the public internet.
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // An IPv4 address written in IPv6 form (::ffff:10.0.0.1 or ::ffff:0a00:0001)
    // is judged as the IPv4 address it contains.
    const mapped = address
      .toLowerCase()
      .match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
    if (mapped) {
      const v4 = mapped[1]
        ? mapped[1]
        : [parseInt(mapped[2], 16), parseInt(mapped[3], 16)]
            .flatMap((part) => [part >> 8, part & 255])
            .join('.');
      return isPublicAddress(v4);
    }
    return !blocked.check(address, 'ipv6');
  }
  return !blocked.check(address, 'ipv4');
}

export class FetchRefused extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
const refuse = (reason, message) => new FetchRefused(reason, message);

// Checks the link's shape. Returns { hostname, path } or throws FetchRefused.
export function parseCvLink(link) {
  if (typeof link !== 'string' || link.trim() === '' || link.length > MAX_URL_LENGTH) {
    throw refuse('invalid_link', 'Enter the CV link as a web address starting with https://.');
  }
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    throw refuse('invalid_link', 'Enter the CV link as a web address starting with https://.');
  }
  if (url.protocol !== 'https:') {
    throw refuse('not_https', 'Only secure https:// links are accepted.');
  }
  if (url.username || url.password) {
    throw refuse('credentials_in_link', 'Links that contain a user name or password are refused.');
  }
  if (url.port && url.port !== '443') {
    throw refuse('bad_port', 'Only links on the standard secure port are accepted.');
  }
  // URL keeps IPv6 literals in brackets; either form of IP address is refused.
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || isIP(hostname) !== 0 || !hostname.includes('.')) {
    throw refuse('not_public', 'The link must use a public web site name.');
  }
  return { hostname, path: `${url.pathname}${url.search}` };
}

// Resolves the name and returns one address, after checking ALL of them.
async function resolvePublicAddress(hostname, resolve) {
  let records;
  try {
    records = await resolve(hostname, { all: true, verbatim: true });
  } catch {
    throw refuse('unreachable', 'The web site name could not be found.');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw refuse('unreachable', 'The web site name could not be found.');
  }
  if (!records.every((record) => isPublicAddress(record.address))) {
    throw refuse('not_public', 'The link points to a private or internal address and was blocked.');
  }
  return records[0];
}

// Downloads one document. `resolve` and `transport` can be replaced in tests,
// so no real network is needed. Returns { buffer } or throws FetchRefused.
export async function fetchCvDocument(
  link,
  { resolve = dnsLookup, transport = httpsRequest, timeoutMs = FETCH_TIMEOUT_MS } = {},
) {
  const { hostname, path } = parseCvLink(link);
  const target = await resolvePublicAddress(hostname, resolve);

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const req = transport(
      {
        // The checked address is what is connected to. The name is only used
        // for the certificate check (servername) and the Host header.
        host: target.address,
        family: target.family,
        port: 443,
        servername: hostname,
        method: 'GET',
        path,
        agent: false,
        headers: {
          Host: hostname,
          Accept:
            'application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/html',
          'Accept-Encoding': 'identity',
          'User-Agent': 'RecruitmentSystem-CVFetch/1',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return finish(
            rejectPromise,
            refuse('redirect', 'The link redirects elsewhere. Use the direct link to the file.'),
          );
        }
        if (status === 401 || status === 403) {
          res.resume();
          return finish(
            rejectPromise,
            refuse('needs_login', 'The link needs a sign-in, which is not supported.'),
          );
        }
        if (status !== 200) {
          res.resume();
          return finish(rejectPromise, refuse('unreachable', 'The link could not be opened.'));
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BYTES) {
          res.resume();
          return finish(rejectPromise, refuse('too_large', 'The file is larger than 5 MB.'));
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            return finish(rejectPromise, refuse('too_large', 'The file is larger than 5 MB.'));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const format = detectFormat(buffer);
          if (format !== 'pdf' && format !== 'zip' && !looksLikeHtml(buffer)) {
            return finish(
              rejectPromise,
              refuse(
                'not_a_document',
                'The link does not lead to a PDF, a Word (.docx) file or a web page. Use a direct link.',
              ),
            );
          }
          finish(resolvePromise, { buffer });
        });
        res.on('error', () =>
          finish(rejectPromise, refuse('unreachable', 'The download was interrupted.')),
        );
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(rejectPromise, refuse('timeout', 'The link took too long to answer.'));
    }, timeoutMs);

    req.on('error', () =>
      finish(rejectPromise, refuse('unreachable', 'The link could not be opened.')),
    );
    req.end();
  });
}

// ---------------------------------------------------------------- browser subrequests

export const SUBRESOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const SUBRESOURCE_TIMEOUT_MS = 10_000;

// One GET for a page being rendered in the isolated browser (the page itself,
// its scripts, data calls and so on). The browser never connects anywhere on
// its own: every request it makes is answered by this function, so the same
// rules as for a CV link apply to each one - HTTPS on the standard port, a
// public host name resolved here and checked, the connection pinned to the
// checked address, no credentials or cookies sent, a size limit and a time
// limit. A redirect is NOT followed: the status and Location are handed back,
// and the browser's follow-up request comes through here and is checked again.
// Returns { status, headers, body } or throws FetchRefused.
export async function fetchSubresource(
  link,
  {
    resolve = dnsLookup,
    transport = httpsRequest,
    timeoutMs = SUBRESOURCE_TIMEOUT_MS,
    maxBytes = SUBRESOURCE_MAX_BYTES,
    accept = '*/*',
    acceptLanguage = 'en',
  } = {},
) {
  const { hostname, path } = parseCvLink(link);
  const target = await resolvePublicAddress(hostname, resolve);

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = transport(
      {
        host: target.address,
        family: target.family,
        port: 443,
        servername: hostname,
        method: 'GET',
        path,
        agent: false,
        headers: {
          Host: hostname,
          Accept: accept,
          'Accept-Language': acceptLanguage,
          'Accept-Encoding': 'identity',
          'User-Agent': 'RecruitmentSystem-CVRender/1',
        },
      },
      (res) => {
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.resume();
          return finish(rejectPromise, refuse('too_large', 'A file the page needs is too large.'));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            return finish(
              rejectPromise,
              refuse('too_large', 'A file the page needs is too large.'),
            );
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(resolvePromise, {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', () =>
          finish(rejectPromise, refuse('unreachable', 'The download was interrupted.')),
        );
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(rejectPromise, refuse('timeout', 'The link took too long to answer.'));
    }, timeoutMs);
    req.on('error', () =>
      finish(rejectPromise, refuse('unreachable', 'The link could not be opened.')),
    );
    req.end();
  });
}
