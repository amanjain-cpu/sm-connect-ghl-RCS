import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSmsAlreadyEnabledMessage } from '../src/services/signalmash-sms-enablement.service.js';

test('Signalmash SMS already-enabled response is treated as idempotent', () => {
  assert.equal(
    isSmsAlreadyEnabledMessage('SMS Service [CF09XDJ] is Already Enabled on this DID [5415656554].'),
    true
  );

  assert.equal(
    isSmsAlreadyEnabledMessage('Signalmash: SMS Service [CF09XDJ] is Already Enabled on this DID [9496860707].'),
    true
  );
});

test('unrelated Signalmash SMS enablement failures are not treated as idempotent', () => {
  assert.equal(
    isSmsAlreadyEnabledMessage('SMS enablement failed for DID 5415656554'),
    false
  );

  assert.equal(
    isSmsAlreadyEnabledMessage('Campaign is not approved for this DID.'),
    false
  );
});
