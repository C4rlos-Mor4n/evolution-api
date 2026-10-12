// KRIONIX: cross-instance override via query/body (#2435) must stay closed. Run: npx tsx --test test/router-instance-scope.test.ts
// server.module first: importing the router alone hits a circular-import init order issue
import '@api/server.module';

import { RouterBroker } from '@api/abstract/abstract.router';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

class TestRouter extends RouterBroker {}

const run = async (req: { baseUrl: string; path: string; params?: any; query?: any; body?: any }) => {
  let seen: any;
  await new TestRouter().dataValidate<any>({
    request: {
      params: req.params ?? {},
      query: req.query ?? {},
      body: req.body ?? {},
      baseUrl: req.baseUrl,
      path: req.path,
      // raw (unencoded) query string, as an attacker can send it
      originalUrl:
        req.baseUrl +
        req.path +
        '?' +
        Object.entries(req.query ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join('&'),
    } as any,
    schema: null,
    ClassRef: class {},
    execute: async (instance) => {
      seen = instance;
    },
  });
  return seen;
};

describe('RouterBroker.dataValidate instance scope', () => {
  it('ignores instanceName in the query of a regular instance route', async () => {
    const i = await run({
      baseUrl: '/message',
      path: '/sendText/mine',
      params: { instanceName: 'mine' },
      query: { instanceName: 'victim' },
    });
    assert.equal(i.instanceName, 'mine');
  });

  it('cannot be bypassed by putting /instance/fetchInstances or /instance/create in the query', async () => {
    const a = await run({
      baseUrl: '/message',
      path: '/sendText/mine',
      params: { instanceName: 'mine' },
      query: { x: '/instance/fetchInstances', instanceName: 'victim' },
    });
    assert.equal(a.instanceName, 'mine');

    const b = await run({
      baseUrl: '/chat',
      path: '/findMessages/mine',
      params: { instanceName: 'mine' },
      query: { x: '/instance/create' },
      body: { instanceName: 'victim' },
    });
    assert.equal(b.instanceName, 'mine');
  });

  it('keeps the legitimate fetchInstances filter and create body', async () => {
    const f = await run({ baseUrl: '/instance', path: '/fetchInstances', query: { instanceName: 'abc' } });
    assert.equal(f.instanceName, 'abc');

    const c = await run({ baseUrl: '/instance', path: '/create', body: { instanceName: 'new-one', instanceId: 'x' } });
    assert.equal(c.instanceName, 'new-one');
    assert.equal(c.instanceId, undefined);
  });
});
