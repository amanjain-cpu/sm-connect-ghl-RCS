import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApprovedTestDevice, mapAgentStatus } from '../src/services/rcs-agent-status.js';

test('recognises an approved test device in any phone format', () => {
  const devices = [{ phoneNumber: '+15125550100', status: 'APPROVED' }, { phoneNumber: '+15125550101', status: 'WAITING_FOR_TESTER_ACCEPTANCE' }, { phoneNumber: '+15125550102', status: 'EXPIRED' }];
  assert.equal(isApprovedTestDevice(devices, '+15125550100'), true);
  assert.equal(isApprovedTestDevice(devices, '(512) 555-0100'), true);
  assert.equal(isApprovedTestDevice(devices, '+15125550101'), false);
  assert.equal(isApprovedTestDevice(devices, '+15125550102'), false);
  assert.equal(isApprovedTestDevice(null, '+15125550100'), false);
});

test('maps the provider agent statuses seen on the dev account', () => {
  assert.equal(mapAgentStatus('READY_FOR_TESTING', 'draft'), 'ready_for_testing');
  assert.equal(mapAgentStatus('LAUNCHED_PARTIAL_SUCCESS', 'draft'), 'pending_launch');
  assert.equal(mapAgentStatus('LIVE', 'draft'), 'live');
  assert.equal(mapAgentStatus('something-new', 'in_testing'), 'in_testing');
});
