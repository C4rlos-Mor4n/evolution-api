// KRIONIX: PATCH /instance/meta-credentials/:instanceName. Run: npx tsx --test test/meta-credentials.test.ts
import '@api/server.module';

import { InstanceController } from '@api/controllers/instance.controller';
import { globalApiKeyGuard } from '@api/guards/global-apikey.guard';
import { validateMetaAccessToken } from '@api/integrations/channel/meta/meta.credentials';
import { Auth, configService } from '@config/env.config';
import axios from 'axios';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const NEW_TOKEN = 'EAAnewTOKENvalue1234567890abcdef';
const OLD_TOKEN = 'EAAoldTOKENvalue1234567890abcdef';
const GLOBAL_KEY = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
const graph = { URL: 'https://graph.test', VERSION: 'v23.0' };

const withAxiosGet = async (impl: (url: string, cfg: any) => any, fn: () => Promise<void>) => {
  const real = axios.get;
  (axios as any).get = async (url: string, cfg: any) => impl(url, cfg);
  try {
    await fn();
  } finally {
    (axios as any).get = real;
  }
};
const fail = (response: any, code?: string) => () => {
  throw Object.assign(new Error('request failed'), { response, code, config: { headers: { Authorization: `Bearer ${NEW_TOKEN}` } } });
};
const noToken = (e: any) => !JSON.stringify(e).includes(NEW_TOKEN);

describe('globalApiKeyGuard', () => {
  const run = async (key?: string) => {
    let called = false;
    try {
      await globalApiKeyGuard({ get: () => key } as any, {} as any, () => {
        called = true;
      });
    } catch (e: any) {
      return `status:${e.status}`;
    }
    return called ? 'next' : 'none';
  };

  it('accepts only the global api key', async () => {
    assert.ok(GLOBAL_KEY, 'test env must have AUTHENTICATION_API_KEY');
    assert.equal(await run(GLOBAL_KEY), 'next');
    assert.equal(await run(OLD_TOKEN), 'status:401');
    assert.equal(await run(undefined), 'status:401');
    assert.equal(await run(GLOBAL_KEY + 'x'), 'status:401');
  });
});

describe('validateMetaAccessToken', () => {
  it('passes when the token can read this phone number id', async () => {
    let seen: any;
    await withAxiosGet(
      (url, cfg) => {
        seen = { url, cfg };
        return { data: { id: '999000333' } };
      },
      () => validateMetaAccessToken(graph, '999000333', NEW_TOKEN),
    );
    assert.equal(seen.url, 'https://graph.test/v23.0/999000333');
    assert.equal(seen.cfg.headers.Authorization, `Bearer ${NEW_TOKEN}`);
    assert.equal(seen.cfg.timeout, 15000);
  });

  it('rejects a token for another number, invalid tokens and outages without leaking the token', async () => {
    await withAxiosGet(
      () => ({ data: { id: '111' } }),
      () =>
        assert.rejects(validateMetaAccessToken(graph, '999000333', NEW_TOKEN), (e: any) => e.status === 400 && noToken(e)),
    );
    await withAxiosGet(fail({ status: 401, data: { error: { message: 'Invalid OAuth access token.', code: 190 } } }), () =>
      assert.rejects(
        validateMetaAccessToken(graph, '999000333', NEW_TOKEN),
        (e: any) => e.status === 400 && /HTTP 401, code 190/.test(JSON.stringify(e.message)) && noToken(e),
      ),
    );
    await withAxiosGet(fail(undefined, 'ECONNABORTED'), () =>
      assert.rejects(validateMetaAccessToken(graph, '999000333', NEW_TOKEN), (e: any) => e.status === 500 && noToken(e)),
    );
    await withAxiosGet(fail({ status: 503, data: {} }), () =>
      assert.rejects(validateMetaAccessToken(graph, '999000333', NEW_TOKEN), (e: any) => e.status === 500 && noToken(e)),
    );
  });
});

describe('InstanceController.updateMetaCredentials', () => {
  const build = (row: any, runtime?: any) => {
    const updates: any[] = [];
    const ctrl: any = Object.create(InstanceController.prototype);
    ctrl.logger = { info: () => {}, error: () => {}, warn: () => {} };
    ctrl.configService = { get: () => graph };
    ctrl.prismaRepository = {
      instance: {
        findUnique: async () => row,
        update: async ({ data }: any) => {
          updates.push(data.token);
          if (row) row.token = data.token;
        },
      },
    };
    ctrl.waMonitor = { waInstances: runtime ? { [row?.name]: runtime } : {} };
    return { ctrl, updates };
  };
  const bizRow = () => ({ id: 'i1', name: 'demo-meta', integration: 'WHATSAPP-BUSINESS', number: '999000333', token: OLD_TOKEN });

  it('validates, updates DB and memory, and never returns the token', async () => {
    const runtime: any = { token: OLD_TOKEN };
    const row = bizRow();
    const { ctrl, updates } = build(row, runtime);
    let res: any;
    await withAxiosGet(
      () => ({ data: { id: '999000333' } }),
      async () => {
        res = await ctrl.updateMetaCredentials({ instanceName: 'demo-meta' }, { accessToken: ` ${NEW_TOKEN} ` });
      },
    );
    assert.deepEqual(res, { success: true, instanceName: 'demo-meta', credentialsUpdated: true });
    assert.deepEqual(updates, [NEW_TOKEN]);
    assert.equal(runtime.token, NEW_TOKEN);
    assert.ok(!JSON.stringify(res).includes(NEW_TOKEN));
  });

  it('keeps the previous token when Meta rejects the new one', async () => {
    const runtime: any = { token: OLD_TOKEN };
    const { ctrl, updates } = build(bizRow(), runtime);
    await withAxiosGet(fail({ status: 401, data: { error: { message: 'Invalid OAuth access token.', code: 190 } } }), () =>
      assert.rejects(ctrl.updateMetaCredentials({ instanceName: 'demo-meta' }, { accessToken: NEW_TOKEN })),
    );
    assert.deepEqual(updates, []);
    assert.equal(runtime.token, OLD_TOKEN);
  });

  it('rolls back the DB if the in-memory update fails', async () => {
    let current = OLD_TOKEN;
    let failOnce = true;
    const runtime: any = {
      get token() {
        return current;
      },
      set token(v: string) {
        if (failOnce && v === NEW_TOKEN) {
          failOnce = false;
          throw new Error('boom');
        }
        current = v;
      },
    };
    const row = bizRow();
    const { ctrl, updates } = build(row, runtime);
    await withAxiosGet(
      () => ({ data: { id: '999000333' } }),
      () =>
        assert.rejects(
          ctrl.updateMetaCredentials({ instanceName: 'demo-meta' }, { accessToken: NEW_TOKEN }),
          (e: any) => e.status === 500,
        ),
    );
    assert.deepEqual(updates, [NEW_TOKEN, OLD_TOKEN]);
    assert.equal(row.token, OLD_TOKEN);
    assert.equal(current, OLD_TOKEN);
  });

  it('404 for unknown instances, 400 for non WHATSAPP-BUSINESS', async () => {
    await assert.rejects(build(null).ctrl.updateMetaCredentials({ instanceName: 'x' }, { accessToken: NEW_TOKEN }), (e: any) => e.status === 404);
    const baileys = { ...bizRow(), integration: 'WHATSAPP-BAILEYS' };
    await assert.rejects(build(baileys).ctrl.updateMetaCredentials({ instanceName: 'demo-meta' }, { accessToken: NEW_TOKEN }), (e: any) => e.status === 400);
  });
});
