import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendDefaultSenderValidationSms } from '../src/services/default-sender-validation.service.js';

const validationInput = {
  signalmashNumberId: '5415656554',
  smsEnablementCampaignId: 'CF09XDJ',
  from: '+15415656554',
  to: '+17195218030',
  body: 'validation body',
  webhookUrl: 'https://api.example.test/api/webhooks/signalmash',
};

test('default sender validation sends the SMS after an already-enabled response', async () => {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const logs: unknown[] = [];

  const result = await sendDefaultSenderValidationSms(
    validationInput,
    {
      async enableSmsForNumber(phoneNumber, campaignId) {
        calls.push({ name: 'enableSmsForNumber', payload: { phoneNumber, campaignId } });
        throw new Error('SMS Service [CF09XDJ] is Already Enabled on this DID [5415656554].');
      },
      async sendMessage(payload) {
        calls.push({ name: 'sendMessage', payload });
        return { messageId: 'validation-message-1', status: 'sent' };
      },
    },
    {
      info(payload, message) {
        logs.push({ payload, message });
      },
    }
  );

  assert.deepEqual(calls, [
    {
      name: 'enableSmsForNumber',
      payload: {
        phoneNumber: '5415656554',
        campaignId: 'CF09XDJ',
      },
    },
    {
      name: 'sendMessage',
      payload: {
        from: '+15415656554',
        to: '+17195218030',
        body: 'validation body',
        webhookUrl: 'https://api.example.test/api/webhooks/signalmash',
      },
    },
  ]);
  assert.deepEqual(result, { messageId: 'validation-message-1', status: 'sent' });
  assert.equal(logs.length, 1);
});

test('default sender validation does not send SMS after unrelated enablement failures', async () => {
  let sendCalls = 0;

  await assert.rejects(
    sendDefaultSenderValidationSms(validationInput, {
      async enableSmsForNumber() {
        throw new Error('Campaign is not approved for this DID.');
      },
      async sendMessage() {
        sendCalls += 1;
        return { messageId: 'should-not-send', status: 'sent' };
      },
    }),
    /Campaign is not approved/
  );

  assert.equal(sendCalls, 0);
});

test('default sender validation still propagates validation SMS failures', async () => {
  await assert.rejects(
    sendDefaultSenderValidationSms(validationInput, {
      async enableSmsForNumber() {},
      async sendMessage() {
        throw new Error('Number is not approved for this MNO');
      },
    }),
    /Number is not approved for this MNO/
  );
});
