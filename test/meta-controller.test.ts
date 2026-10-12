// KRIONIX: Meta webhook controller dispatch. Run: npx tsx --test test/meta-controller.test.ts
// server.module first: importing the controller alone hits a circular-import init order issue
import '@api/server.module';

import { MetaController } from '@api/integrations/channel/meta/meta.controller';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const change = (numberId: string, id: string) => ({
  field: 'messages',
  value: { metadata: { phone_number_id: numberId }, messages: [{ id }] },
});

describe('MetaController.receiveWebhook', () => {
  it('dispatches every entry x change to the right instance and survives failures', async () => {
    const calls: string[] = [];
    const prisma: any = {
      instance: {
        findFirst: async ({ where }: any) =>
          ({ '111': { name: 'inst-a' }, '222': { name: 'inst-b' }, '333': { name: 'not-loaded' } })[where.number] ??
          null,
      },
    };
    const monitor: any = {
      waInstances: {
        'inst-a': {
          connectToWhatsapp: async (d: any) => calls.push(`a:${d.entry[0].changes[0].value.messages[0].id}`),
        },
        'inst-b': {
          connectToWhatsapp: async () => {
            throw new Error('boom');
          },
        },
      },
    };
    const controller = new MetaController(prisma, monitor);
    (controller as any).logger = { error: () => {}, warn: () => {} };

    const res = await controller.receiveWebhook({
      object: 'whatsapp_business_account',
      entry: [
        { changes: [change('111', 'm1'), change('222', 'm2')] },
        { changes: [change('111', 'm3'), change('333', 'm4'), change('999', 'm5')] },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(res, { status: 'success' });
    assert.deepEqual(calls.sort(), ['a:m1', 'a:m3']);
  });
});
