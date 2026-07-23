export function isSmsAlreadyEnabledMessage(message: unknown): boolean {
  return (
    typeof message === 'string' &&
    /sms\s+service\b/i.test(message) &&
    /already\s+enabled\s+on\s+this\s+did/i.test(message)
  );
}
