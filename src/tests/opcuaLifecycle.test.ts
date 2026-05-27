import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

test('OPC UA client does not resubscribe inside ensureConnected before subscribe creates one', () => {
  const source = fs.readFileSync(new URL('../../src/opcua/OpcUaClient.ts', import.meta.url), 'utf8');
  const ensureConnectedStart = source.indexOf('private async ensureConnected');
  const ensureConnectedEnd = source.indexOf('/**\n   * Subscribe to a set of tags', ensureConnectedStart);
  const ensureConnected = source.slice(ensureConnectedStart, ensureConnectedEnd);

  assert.equal(ensureConnected.includes('setupSubscription(this.desiredTags'), false);
  assert.equal(source.includes("this.scheduleResubscribe('subscription_terminated')"), true);
  assert.equal(source.includes("this.scheduleReconnect('subscription_terminated')"), false);
});
