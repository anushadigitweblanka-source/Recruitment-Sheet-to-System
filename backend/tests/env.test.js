import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config/env.js';

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'some_db',
  DB_USER: 'some_user',
  DB_PASSWORD: 'not-a-real-password',
};

test('loadConfig returns the database settings and sensible defaults', () => {
  const config = loadConfig(validEnv);

  assert.equal(config.db.host, 'localhost');
  assert.equal(config.db.port, 5432);
  assert.equal(config.db.database, 'some_db');
  assert.equal(config.environment, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
});

test('loadConfig names every missing variable', () => {
  assert.throws(
    () => loadConfig({ DB_HOST: 'localhost' }),
    (err) => {
      for (const name of ['DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
        assert.ok(err.message.includes(name), `${name} should be named`);
      }
      return true;
    },
  );
});

test('loadConfig never puts a value in its error message', () => {
  const env = { ...validEnv, DB_PORT: 'not-a-port' };

  assert.throws(
    () => loadConfig(env),
    (err) => {
      assert.match(err.message, /DB_PORT/);
      assert.ok(!err.message.includes(validEnv.DB_PASSWORD));
      return true;
    },
  );
});

test('loadConfig rejects an out-of-range port', () => {
  assert.throws(() => loadConfig({ ...validEnv, DB_PORT: '70000' }), /DB_PORT/);
});
