// KRIONIX: GROUP_UPDATE / GROUPS_UPDATE aliasing (upstream #2652). Run: npx tsx --test test/event-aliases.test.ts
import { isEventEnabled, isEventInList } from '@utils/eventAliases';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const key = (event: string) => event.replace(/[.-]/gm, '_').toUpperCase();

describe('event aliases', () => {
  it('groups.update matches a legacy GROUP_UPDATE subscription', () => {
    assert.equal(isEventInList(['MESSAGES_UPSERT', 'GROUP_UPDATE'], key('groups.update')), true);
    assert.equal(isEventEnabled({ GROUP_UPDATE: true }, key('groups.update')), true);
  });

  it('groups.update matches the new GROUPS_UPDATE name', () => {
    assert.equal(isEventInList(['GROUPS_UPDATE'], key('groups.update')), true);
  });

  it('other events are unchanged', () => {
    assert.equal(isEventInList(['MESSAGES_UPSERT'], key('messages.upsert')), true);
    assert.equal(isEventInList(['MESSAGES_UPSERT'], key('messages.update')), false);
    assert.equal(isEventInList(undefined, key('messages.upsert')), false);
    assert.equal(isEventEnabled({ MESSAGES_UPDATE: false }, key('messages.update')), false);
  });
});
