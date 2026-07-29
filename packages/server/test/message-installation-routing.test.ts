import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateInstallationSenderPolicy } from '../src/services/message-installation-routing.service.js';

test('embedded send allows a sender assigned to the active installation', () => {
  const result = evaluateInstallationSenderPolicy({
    installationId: 'installation-sWmK39aPQAVSVxqGib0Z',
    selectedPhoneNumberId: 'number-15415656554',
    selectedSenderKey: '+15415656554',
    senderProfiles: [
      {
        id: 'sender-profile-active-location',
        phoneNumberId: 'number-15415656554',
        senderKey: '+15415656554',
        phoneNumberActive: true,
      },
    ],
  });

  assert.deepEqual(result, {
    allowed: true,
    matchedProfileId: 'sender-profile-active-location',
  });
});

test('embedded send rejects an organization sender that is only assigned to another installation', () => {
  const result = evaluateInstallationSenderPolicy({
    installationId: 'installation-sWmK39aPQAVSVxqGib0Z',
    selectedPhoneNumberId: 'number-15415656554',
    selectedSenderKey: '+15415656554',
    senderProfiles: [
      {
        id: 'sender-profile-other-location',
        phoneNumberId: 'number-15551234567',
        senderKey: '+15551234567',
        phoneNumberActive: true,
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'sender_not_assigned');
  assert.equal(
    result.message,
    'The selected sender number is not assigned to this connected CRM workspace.'
  );
});

test('embedded send fails clearly when the active installation has no sender profile', () => {
  const result = evaluateInstallationSenderPolicy({
    installationId: 'installation-sWmK39aPQAVSVxqGib0Z',
    selectedPhoneNumberId: 'number-15415656554',
    selectedSenderKey: '+15415656554',
    senderProfiles: [],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'no_workspace_sender');
  assert.equal(
    result.message,
    'No active sender is configured for this connected CRM workspace. Assign a sender number before sending.'
  );
});

test('admin organization sends without embedded installation remain organization scoped', () => {
  const result = evaluateInstallationSenderPolicy({
    installationId: null,
    selectedPhoneNumberId: 'number-15415656554',
    selectedSenderKey: '+15415656554',
    senderProfiles: [],
  });

  assert.deepEqual(result, { allowed: true });
});
