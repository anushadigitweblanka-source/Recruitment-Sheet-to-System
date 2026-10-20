import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import tls from 'node:tls';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { describeCertificates } from '../scripts/dbCheck.js';
import { loadConfig } from '../src/config/env.js';

// Trusting a company PostgreSQL certificate (DB_SSL_CA), tested with FICTIONAL
// throwaway certificates made at test time and a fake server that only does the
// TLS handshake. No key or certificate is stored in the repository, nothing
// leaves this computer, and certificate checking is never switched off.

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../scripts/check-db-connection.js', import.meta.url));

const OPENSSL = [
  'openssl',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
].find((candidate) => {
  try {
    execFileSync(candidate, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

const BASE_ENV = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_NAME: 'fictional_db',
  DB_USER: 'fictional_user',
  DB_PASSWORD: 'not-a-real-password',
};

describe(
  'DB_SSL_CA with fictional certificates',
  { skip: !OPENSSL && 'openssl was not found' },
  () => {
    let dir;
    let server; // { key, cert } for db.example.test / 127.0.0.1
    let other; // an unrelated self-signed certificate

    function makeCertificate(name, subject, altNames) {
      const conf = path.join(dir, 'openssl.cnf');
      const key = path.join(dir, `${name}.key`);
      const crt = path.join(dir, `${name}.crt`);
      execFileSync(
        OPENSSL,
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '30',
          '-config',
          conf,
          '-keyout',
          key,
          '-out',
          crt,
          '-subj',
          subject,
          '-addext',
          `subjectAltName=${altNames}`,
        ],
        { stdio: 'ignore' },
      );
      return { key: readFileSync(key, 'utf8'), cert: readFileSync(crt, 'utf8'), file: crt };
    }

    let authority; // a fictional company certificate authority
    let leaf; // a server certificate signed by that authority
    let expired; // null when this OpenSSL cannot set validity dates
    let future;

    const openssl = (...args) => execFileSync(OPENSSL, args, { stdio: 'ignore' });
    const conf = () => path.join(dir, 'openssl.cnf');

    function makeAuthority(name) {
      const key = path.join(dir, `${name}.key`);
      const crt = path.join(dir, `${name}.crt`);
      openssl(
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '30',
        '-config',
        conf(),
        '-keyout',
        key,
        '-out',
        crt,
        '-subj',
        '/CN=Fictional Authority',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
      );
      return { key, cert: readFileSync(crt, 'utf8'), file: crt };
    }

    function makeLeaf(name, ca, altNames) {
      const key = path.join(dir, `${name}.key`);
      const csr = path.join(dir, `${name}.csr`);
      const crt = path.join(dir, `${name}.crt`);
      const ext = path.join(dir, `${name}.ext`);
      writeFileSync(ext, `subjectAltName=${altNames}\nbasicConstraints=CA:FALSE\n`);
      openssl(
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-config',
        conf(),
        '-keyout',
        key,
        '-out',
        csr,
        '-subj',
        '/CN=db.example.test',
      );
      openssl(
        'x509',
        '-req',
        '-in',
        csr,
        '-CA',
        ca.file,
        '-CAkey',
        ca.key,
        '-CAcreateserial',
        '-days',
        '30',
        '-out',
        crt,
        '-extfile',
        ext,
      );
      return { key: readFileSync(key, 'utf8'), cert: readFileSync(crt, 'utf8'), file: crt };
    }

    function makeDated(name, notBefore, notAfter) {
      const key = path.join(dir, `${name}.key`);
      const crt = path.join(dir, `${name}.crt`);
      try {
        openssl(
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-config',
          conf(),
          '-keyout',
          key,
          '-out',
          crt,
          '-subj',
          '/CN=db.example.test',
          '-not_before',
          notBefore,
          '-not_after',
          notAfter,
        );
        return { key: readFileSync(key, 'utf8'), cert: readFileSync(crt, 'utf8'), file: crt };
      } catch {
        return null;
      }
    }

    before(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'dbssl-'));
      writeFileSync(path.join(dir, 'openssl.cnf'), '[req]\ndistinguished_name=dn\n[dn]\n');
      server = makeCertificate('server', '/CN=db.example.test', 'DNS:db.example.test,IP:127.0.0.1');
      other = makeCertificate('other', '/CN=other.example.test', 'DNS:other.example.test');
      authority = makeAuthority('authority');
      leaf = makeLeaf('leaf', authority, 'DNS:db.example.test,IP:127.0.0.1');
      expired = makeDated('expired', '20200101000000Z', '20200102000000Z');
      future = makeDated('future', '20990101000000Z', '20990102000000Z');
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    const sslFor = (extra) => loadConfig({ ...BASE_ENV, ...extra }).db.ssl;

    describe('configuration', () => {
      test('accepts the certificate as text, as one line with \\n, or as base64', () => {
        // Windows OpenSSL writes CRLF line ends; the setting is compared after
        // normalising them.
        const pem = server.cert.trim().replace(/\r\n/g, '\n');
        for (const value of [
          pem,
          pem.replace(/\r?\n/g, '\\n'),
          Buffer.from(pem).toString('base64'),
        ]) {
          const ssl = sslFor({ DB_SSL_CA: value });
          assert.equal(ssl.ca, pem);
          assert.equal(ssl.rejectUnauthorized, true);
        }
      });

      test('keeps checking on and passes the expected name through', () => {
        const ssl = sslFor({
          DB_SSL_CA: server.cert,
          DB_SSL: 'true',
          DB_SSL_SERVERNAME: 'db.example.test',
        });
        assert.equal(ssl.rejectUnauthorized, true);
        assert.equal(ssl.servername, 'db.example.test');
      });

      test('refuses a private key, text that is not a certificate, and a bad name', () => {
        assert.throws(() => sslFor({ DB_SSL_CA: server.key }), /never a private key/);
        assert.throws(
          () => sslFor({ DB_SSL_CA: `${server.cert}\n${server.key}` }),
          /never a private key/,
        );
        assert.throws(() => sslFor({ DB_SSL_CA: 'hello world' }), /must contain a PEM certificate/);
        assert.throws(
          () => sslFor({ DB_SSL_CA: server.cert, DB_SSL_SERVERNAME: 'bad name;x' }),
          /DB_SSL_SERVERNAME/,
        );
      });

      test('a certificate can never be combined with switching checking off', () => {
        // "no-verify" no longer exists: it is not a valid DB_SSL value at all.
        assert.throws(
          () => sslFor({ DB_SSL_CA: server.cert, DB_SSL: 'no-verify' }),
          /must be true or false/,
        );
        assert.throws(() => sslFor({ DB_SSL: 'no-verify' }), /must be true or false/);
        assert.throws(
          () => sslFor({ DB_SSL_CA: server.cert, DB_SSL: 'false' }),
          /needs DB_SSL=true/,
        );
        assert.equal(sslFor({ DB_SSL_CA: server.cert }).rejectUnauthorized, true);
      });

      test('an error never contains the certificate or key text', () => {
        try {
          sslFor({ DB_SSL_CA: server.key });
          assert.fail('should have thrown');
        } catch (err) {
          assert.equal(err.message.includes('BEGIN'), false);
          assert.equal(err.message.includes(server.key.slice(40, 80)), false);
        }
      });
    });

    describe('expired certificates, the fingerprint pin and the certificate chain', () => {
      test('an expired certificate is refused', (t) => {
        if (!expired) return t.skip('this OpenSSL cannot set certificate dates');
        assert.throws(() => sslFor({ DB_SSL_CA: expired.cert }), /has expired/);
      });

      test('a certificate that is not valid yet is refused', (t) => {
        if (!future) return t.skip('this OpenSSL cannot set certificate dates');
        assert.throws(() => sslFor({ DB_SSL_CA: future.cert }), /not valid yet/);
      });

      test('the fingerprint pin accepts the right certificate in every common written form', () => {
        const fingerprint = new X509Certificate(server.cert).fingerprint256;
        for (const written of [
          fingerprint,
          fingerprint.replace(/:/g, '').toLowerCase(),
          `sha256 Fingerprint=${fingerprint}`,
          ` ${fingerprint} `,
        ]) {
          const ssl = sslFor({ DB_SSL_CA: server.cert, DB_SSL_CA_SHA256: written });
          assert.equal(ssl.rejectUnauthorized, true);
        }
      });

      test('the fingerprint pin refuses a different certificate and a malformed value', () => {
        const otherPrint = new X509Certificate(other.cert).fingerprint256;
        assert.throws(
          () => sslFor({ DB_SSL_CA: server.cert, DB_SSL_CA_SHA256: otherPrint }),
          /does not match DB_SSL_CA_SHA256/,
        );
        assert.throws(
          () => sslFor({ DB_SSL_CA: server.cert, DB_SSL_CA_SHA256: 'AB:CD' }),
          /must be a SHA-256 fingerprint/,
        );
        assert.throws(() => sslFor({ DB_SSL_CA_SHA256: otherPrint }), /needs DB_SSL_CA/);
      });

      test('no combination of settings ever switches certificate checking off', () => {
        const pem = server.cert;
        const combos = [
          { DB_SSL: 'true' },
          { DB_SSL: 'true', DB_SSL_SERVERNAME: 'db.example.test' },
          { DB_SSL_CA: pem },
          { DB_SSL_CA: pem, DB_SSL: 'true' },
          { DB_SSL_CA: pem, DB_SSL_SERVERNAME: 'db.example.test' },
          { DB_SSL_CA: pem, DB_SSL_CA_SHA256: new X509Certificate(pem).fingerprint256 },
        ];
        for (const env of combos) assert.equal(sslFor(env).rejectUnauthorized, true);
        // Anything that would turn it off is an error, never a quiet downgrade.
        for (const env of [{ DB_SSL: 'no-verify' }, { DB_SSL: 'off' }, { DB_SSL: '0' }]) {
          assert.throws(() => sslFor(env), /DB_SSL must be true or false/);
        }
        const source = readFileSync(new URL('../src/config/env.js', import.meta.url), 'utf8');
        assert.equal(/rejectUnauthorized:\s*false/.test(source), false);
      });

      describe('a server certificate signed by a company authority', () => {
        let listener;
        let port;
        let completed;

        before(async () => {
          const tlsServer = tls.createServer({ key: leaf.key, cert: leaf.cert }, (secure) => {
            completed += 1;
            secure.on('error', () => {});
            secure.destroy();
          });
          tlsServer.on('tlsClientError', () => {});
          listener = net.createServer((socket) => {
            socket.on('error', () => {});
            socket.once('data', () => {
              socket.write('S');
              tlsServer.emit('connection', socket);
            });
          });
          await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
          port = listener.address().port;
        });
        after(() => new Promise((resolve) => listener.close(resolve)));

        async function connect(ssl) {
          completed = 0;
          const client = new pg.Client({
            host: BASE_ENV.DB_HOST,
            port,
            database: BASE_ENV.DB_NAME,
            user: BASE_ENV.DB_USER,
            password: BASE_ENV.DB_PASSWORD,
            ssl,
            connectionTimeoutMillis: 4000,
          });
          let code = null;
          try {
            await client.connect();
          } catch (err) {
            code = err.code ?? null;
          } finally {
            await client.end().catch(() => {});
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { code, completed };
        }

        test('trusting the authority validates the server certificate through the chain', async () => {
          const result = await connect(sslFor({ DB_SSL_CA: authority.cert }));
          assert.equal(result.completed, 1);
        });

        test('the same server is refused when the authority is not the one supplied', async () => {
          const result = await connect(sslFor({ DB_SSL_CA: other.cert }));
          assert.equal(result.completed, 0);
          assert.notEqual(result.code, null);
        });

        test('the same server is refused with no certificate supplied at all', async () => {
          const result = await connect(sslFor({ DB_SSL: 'true' }));
          assert.equal(result.completed, 0);
          assert.match(result.code, /SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/);
        });

        test('a wrong server name is refused even though the chain is valid', async () => {
          const result = await connect(
            sslFor({ DB_SSL_CA: authority.cert, DB_SSL_SERVERNAME: 'wrong.example.test' }),
          );
          assert.equal(result.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
          assert.equal(result.completed, 0);
        });
      });
    });

    describe('the TLS handshake against a fake server', () => {
      let listener;
      let port;
      let completed;

      before(async () => {
        // A real TLS server whose handshakes are counted; the front door below hands
        // each connection to it after the PostgreSQL "SSLRequest" exchange.
        const tlsServer = tls.createServer({ key: server.key, cert: server.cert }, (secure) => {
          completed += 1;
          secure.on('error', () => {});
          secure.destroy();
        });
        tlsServer.on('tlsClientError', () => {});
        listener = net.createServer((socket) => {
          socket.on('error', () => {});
          // PostgreSQL clients ask "SSLRequest" first; answer S, then speak TLS.
          socket.once('data', () => {
            socket.write('S');
            tlsServer.emit('connection', socket);
          });
        });
        await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
        port = listener.address().port;
      });
      after(() => new Promise((resolve) => listener.close(resolve)));

      async function connect(ssl) {
        completed = 0;
        const client = new pg.Client({
          host: BASE_ENV.DB_HOST,
          port,
          database: BASE_ENV.DB_NAME,
          user: BASE_ENV.DB_USER,
          password: BASE_ENV.DB_PASSWORD,
          ssl,
          connectionTimeoutMillis: 4000,
        });
        let outcome;
        try {
          await client.connect();
          outcome = { code: null };
        } catch (err) {
          outcome = { code: err.code ?? null, message: err.message };
        } finally {
          await client.end().catch(() => {});
        }
        // Give the fake server a moment to record a finished handshake.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { ...outcome, completed };
      }

      test('reproduces the self-signed error when the certificate is not supplied', async () => {
        const result = await connect(sslFor({ DB_SSL: 'true' }));
        assert.equal(result.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
        assert.equal(result.completed, 0);
      });

      test('trusts the supplied certificate and gets past the handshake', async () => {
        const result = await connect(sslFor({ DB_SSL_CA: server.cert }));
        assert.equal(result.completed, 1, JSON.stringify(result));
        assert.notEqual(result.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
      });

      test('a name that is in the certificate works even when connecting by address', async () => {
        const result = await connect(
          sslFor({ DB_SSL_CA: server.cert, DB_SSL_SERVERNAME: 'db.example.test' }),
        );
        assert.equal(result.completed, 1, JSON.stringify(result));
      });

      test('a name that is not in the certificate is refused', async () => {
        const result = await connect(
          sslFor({ DB_SSL_CA: server.cert, DB_SSL_SERVERNAME: 'wrong.example.test' }),
        );
        assert.equal(result.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
        assert.equal(result.completed, 0);
      });

      test('a different certificate does not make the server trusted', async () => {
        const result = await connect(sslFor({ DB_SSL_CA: other.cert }));
        assert.equal(result.completed, 0);
        assert.ok(
          [
            'DEPTH_ZERO_SELF_SIGNED_CERT',
            'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            'SELF_SIGNED_CERT_IN_CHAIN',
          ].includes(result.code),
          result.code,
        );
      });

      test('the check command: fingerprint shown, no secret printed, TLS passes', async () => {
        const env = {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ...BASE_ENV,
          DB_PORT: String(port),
          DB_SSL_CA: server.cert,
        };
        await assert.rejects(run(process.execPath, [CLI], { env }), (err) => {
          // It gets past TLS; this fake server then hangs up instead of speaking PostgreSQL.
          assert.match(err.stdout, /Step 1b/);
          assert.match(err.stdout, /SHA-256 fingerprint: ([0-9A-F]{2}:){31}[0-9A-F]{2}/);
          assert.match(err.stdout, /name matches server: yes/);
          assert.match(err.stdout, /DB_SSL_CA\s+SET/);
          assert.match(err.stderr, /closed the connection while it was starting/);
          for (const secret of [
            'not-a-real-password',
            'fictional_user',
            'db.example.test',
            'BEGIN CERTIFICATE',
          ]) {
            assert.equal((err.stdout + err.stderr).includes(secret), false, secret);
          }
          return true;
        });
      });

      test('the check command explains the self-signed error and the safe fix', async () => {
        const env = {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          ...BASE_ENV,
          DB_PORT: String(port),
          DB_SSL: 'true',
        };
        await assert.rejects(run(process.execPath, [CLI], { env }), (err) => {
          assert.match(err.stderr, /self-signed certificate/);
          assert.match(err.stderr, /DB_SSL_CA/);
          assert.match(err.stderr, /Do not turn checking off/);
          return true;
        });
      });
    });

    describe('describing the supplied certificate', () => {
      test('the fingerprint equals the one OpenSSL prints for the file', () => {
        const [text] = describeCertificates(server.cert, { host: '127.0.0.1' });
        const fromOpenSsl = execFileSync(OPENSSL, [
          'x509',
          '-in',
          server.file,
          '-noout',
          '-fingerprint',
          '-sha256',
        ])
          .toString()
          .trim()
          .split('=')[1];
        assert.ok(text.includes(fromOpenSsl), 'fingerprints differ');
        assert.match(text, /self-signed:\s+yes/);
        assert.match(text, /name matches server: yes/);
      });

      test('says NO when the certificate was not issued for the name used', () => {
        assert.match(
          describeCertificates(server.cert, {
            host: '127.0.0.1',
            servername: 'wrong.example.test',
          })[0],
          /name matches server: NO/,
        );
        assert.match(
          describeCertificates(other.cert, { host: '127.0.0.1' })[0],
          /name matches server: NO/,
        );
      });

      test('shows no subject or server name', () => {
        assert.equal(
          describeCertificates(server.cert, { host: '127.0.0.1' })[0].includes('example.test'),
          false,
        );
      });
    });

    test('no certificate or key file is left in the repository', () => {
      const repo = fileURLToPath(new URL('../../', import.meta.url));
      for (const name of ['server.key', 'server.crt', 'other.key', 'other.crt']) {
        assert.equal(existsSync(path.join(repo, name)), false);
      }
    });
  },
);
