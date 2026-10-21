// Tests for fetching a CV from a link. The network is fully mocked: DNS is a
// stub and the HTTPS transport is a fake, so no real connection is ever made.
// Documents and addresses are fictional (example.test hosts, documentation
// IP ranges).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  FetchRefused,
  fetchCvDocument,
  isPublicAddress,
  parseCvLink,
} from '../src/modules/cv-extraction/safeFetch.js';
import { MAX_BYTES } from '../src/modules/cv-extraction/textExtractor.js';
import { FULL_CV, buildDocx, buildPdf } from './helpers/fictionalCv.js';

const PUBLIC_IP = '93.184.216.34';

const resolveTo = (...addresses) => {
  const calls = [];
  const resolve = async (hostname, options) => {
    calls.push({ hostname, options });
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  resolve.calls = calls;
  return resolve;
};

// A fake https.request. `reply` describes the server's answer.
function fakeTransport(reply) {
  const calls = [];
  const transport = (options, onResponse) => {
    calls.push(options);
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };
    req.end = () => {
      if (reply.silent) return; // never answers
      if (reply.networkError) return setImmediate(() => req.emit('error', new Error('boom')));
      const res = new PassThrough();
      res.statusCode = reply.status ?? 200;
      res.headers = reply.headers ?? {};
      setImmediate(() => {
        onResponse(res);
        for (const chunk of [].concat(reply.body ?? [])) res.write(chunk);
        res.end();
      });
    };
    return req;
  };
  transport.calls = calls;
  return transport;
}

const refusal = (promise, reason) =>
  assert.rejects(promise, (err) => err instanceof FetchRefused && err.reason === reason);

test('a direct HTTPS link to a PDF is downloaded', async () => {
  const pdf = await buildPdf(FULL_CV);
  const transport = fakeTransport({ body: pdf });
  const result = await fetchCvDocument('https://cv.example.test/files/nimali.pdf?v=2', {
    resolve: resolveTo(PUBLIC_IP),
    transport,
  });
  assert.deepEqual(result.buffer, pdf);
  assert.equal(transport.calls[0].path, '/files/nimali.pdf?v=2');
});

test('a direct HTTPS link to a Word file is downloaded', async () => {
  const docx = await buildDocx(FULL_CV);
  const result = await fetchCvDocument('https://cv.example.test/nimali.docx', {
    resolve: resolveTo(PUBLIC_IP),
    transport: fakeTransport({ body: docx }),
  });
  assert.deepEqual(result.buffer, docx);
});

test('the connection goes to the one checked address, with no cookies or credentials', async () => {
  const resolve = resolveTo(PUBLIC_IP);
  const transport = fakeTransport({ body: await buildPdf(FULL_CV) });
  await fetchCvDocument('https://cv.example.test/a.pdf', { resolve, transport });

  // The name is resolved once; the request uses the checked address, so a
  // second (rebinding) lookup can never happen.
  assert.equal(resolve.calls.length, 1);
  const [options] = transport.calls;
  assert.equal(options.host, PUBLIC_IP);
  assert.equal(options.servername, 'cv.example.test');
  assert.equal(options.headers.Host, 'cv.example.test');
  assert.equal(options.port, 443);
  const names = Object.keys(options.headers).map((n) => n.toLowerCase());
  for (const forbidden of ['cookie', 'authorization', 'proxy-authorization']) {
    assert.equal(names.includes(forbidden), false, forbidden);
  }
});

test('links that are not plain public HTTPS addresses are refused before any lookup', async () => {
  const cases = [
    ['http://cv.example.test/a.pdf', 'not_https'],
    ['ftp://cv.example.test/a.pdf', 'not_https'],
    ['file:///etc/passwd', 'not_https'],
    ['https://user:pass@cv.example.test/a.pdf', 'credentials_in_link'],
    ['https://cv.example.test:8443/a.pdf', 'bad_port'],
    ['https://localhost/a.pdf', 'not_public'],
    ['https://intranet/a.pdf', 'not_public'],
    ['https://127.0.0.1/a.pdf', 'not_public'],
    ['https://169.254.169.254/latest/meta-data/', 'not_public'],
    ['https://[::1]/a.pdf', 'not_public'],
    ['https://2130706433/a.pdf', 'not_public'], // 127.0.0.1 written as one number
    ['not a link', 'invalid_link'],
    ['', 'invalid_link'],
    [null, 'invalid_link'],
    [`https://cv.example.test/${'a'.repeat(2100)}`, 'invalid_link'],
  ];
  for (const [link, reason] of cases) {
    const resolve = resolveTo(PUBLIC_IP);
    const transport = fakeTransport({});
    await refusal(fetchCvDocument(link, { resolve, transport }), reason);
    assert.equal(resolve.calls.length, 0, `${link} must not be looked up`);
    assert.equal(transport.calls.length, 0, `${link} must not be requested`);
  }
});

test('a name that resolves to a private or internal address is blocked', async () => {
  for (const address of [
    '10.0.0.5',
    '172.16.4.4',
    '192.168.1.10',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
  ]) {
    const transport = fakeTransport({ body: Buffer.from('%PDF-1.4') });
    await refusal(
      fetchCvDocument('https://innocent.example.test/a.pdf', {
        resolve: resolveTo(address),
        transport,
      }),
      'not_public',
    );
    assert.equal(transport.calls.length, 0, `${address} must not be connected to`);
  }
});

test('one private address among several public ones blocks the link (rebinding defence)', async () => {
  const transport = fakeTransport({ body: Buffer.from('%PDF-1.4') });
  await refusal(
    fetchCvDocument('https://rebind.example.test/a.pdf', {
      resolve: resolveTo(PUBLIC_IP, '10.0.0.5'),
      transport,
    }),
    'not_public',
  );
  assert.equal(transport.calls.length, 0);
});

test('isPublicAddress separates public from non-public ranges', () => {
  for (const ok of [PUBLIC_IP, '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(ok), true, ok);
  }
  for (const no of ['10.1.1.1', '192.168.0.1', '224.0.0.1', '255.255.255.255', 'fc00::1', 'junk']) {
    assert.equal(isPublicAddress(no), false, no);
  }
});

test('a name that does not resolve gives a clear error', async () => {
  const resolve = async () => {
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  };
  await refusal(fetchCvDocument('https://nowhere.example.test/a.pdf', { resolve }), 'unreachable');
});

test('redirects are refused, not followed', async () => {
  const transport = fakeTransport({
    status: 302,
    headers: { location: 'https://internal.example.test/secret.pdf' },
  });
  await refusal(
    fetchCvDocument('https://cv.example.test/a.pdf', { resolve: resolveTo(PUBLIC_IP), transport }),
    'redirect',
  );
  assert.equal(transport.calls.length, 1, 'no second request was made');
});

test('a link that needs a sign-in is refused, not bypassed', async () => {
  for (const status of [401, 403]) {
    await refusal(
      fetchCvDocument('https://cv.example.test/a.pdf', {
        resolve: resolveTo(PUBLIC_IP),
        transport: fakeTransport({ status }),
      }),
      'needs_login',
    );
  }
});

test('other failures give a clear error', async () => {
  const run = (reply) =>
    fetchCvDocument('https://cv.example.test/a.pdf', {
      resolve: resolveTo(PUBLIC_IP),
      transport: fakeTransport(reply),
    });
  await refusal(run({ status: 404 }), 'unreachable');
  await refusal(run({ status: 500 }), 'unreachable');
  await refusal(run({ networkError: true }), 'unreachable');
});

test('something that is not a document or a web page is refused, whatever its content type says', async () => {
  await refusal(
    fetchCvDocument('https://drive.example.test/file/d/abc/view', {
      resolve: resolveTo(PUBLIC_IP),
      transport: fakeTransport({
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('{"error": "Sign in to continue"}'),
      }),
    }),
    'not_a_document',
  );
});

test('a file over 5 MB is refused, by its declared size and by its real size', async () => {
  await refusal(
    fetchCvDocument('https://cv.example.test/big.pdf', {
      resolve: resolveTo(PUBLIC_IP),
      transport: fakeTransport({ headers: { 'content-length': String(MAX_BYTES + 1) } }),
    }),
    'too_large',
  );
  // The server understates the size; the bytes actually received are counted.
  await refusal(
    fetchCvDocument('https://cv.example.test/big.pdf', {
      resolve: resolveTo(PUBLIC_IP),
      transport: fakeTransport({
        headers: { 'content-length': '100' },
        body: [Buffer.from('%PDF-'), Buffer.alloc(MAX_BYTES, 1)],
      }),
    }),
    'too_large',
  );
});

test('a link that never answers times out', async () => {
  const transport = fakeTransport({ silent: true });
  await refusal(
    fetchCvDocument('https://slow.example.test/a.pdf', {
      resolve: resolveTo(PUBLIC_IP),
      transport,
      timeoutMs: 40,
    }),
    'timeout',
  );
});

test('errors never repeat the link, so secrets in it cannot leak', async () => {
  const secret = 'SUPERSECRETTOKEN123';
  const attempts = [
    fetchCvDocument(`https://user:${secret}@cv.example.test/a.pdf`),
    fetchCvDocument(`http://cv.example.test/a.pdf?token=${secret}`),
    fetchCvDocument(`https://cv.example.test/a.pdf?token=${secret}`, {
      resolve: resolveTo('10.0.0.1'),
    }),
    fetchCvDocument(`https://cv.example.test/a.pdf?token=${secret}`, {
      resolve: resolveTo(PUBLIC_IP),
      transport: fakeTransport({ status: 403 }),
    }),
  ];
  for (const attempt of attempts) {
    await assert.rejects(attempt, (err) => {
      assert.ok(err instanceof FetchRefused);
      assert.equal(`${err.message} ${err.reason}`.includes(secret), false);
      return true;
    });
  }
});

test('parseCvLink returns the host and path of an acceptable link', () => {
  assert.deepEqual(parseCvLink(' https://CV.example.test/x/y.pdf?a=1 '), {
    hostname: 'cv.example.test',
    path: '/x/y.pdf?a=1',
  });
});
