export const NUMBER_NOT_APPROVED_FOR_MNO_PATTERN = /number is not approved for this mno/i;

export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

export function isNumberNotApprovedForMnoError(error: unknown): boolean {
  return NUMBER_NOT_APPROVED_FOR_MNO_PATTERN.test(getErrorMessage(error, String(error ?? '')));
}
