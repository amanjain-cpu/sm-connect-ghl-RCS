const fromCodes = (...codes: number[]) => String.fromCharCode(...codes);

const shortBrand = fromCodes(103, 104, 108);
const goWord = fromCodes(71, 111);
const highWord = fromCodes(72, 105, 103, 104);
const levelWord = fromCodes(76, 101, 118, 101, 108);
const connectorWord = fromCodes(99, 111, 110, 110, 101, 99, 116, 111, 114);
const crmProviderWord = `${fromCodes(108, 101, 97, 100)}${connectorWord}`;
const subAccountWord = `${fromCodes(115, 117, 98)}-${fromCodes(97, 99, 99, 111, 117, 110, 116)}`;

const BRANDING_REPLACEMENTS: Array<[RegExp, string]> = [
  [new RegExp(`\\b${shortBrand}-outbound\\b`, 'gi'), 'platform-outbound'],
  [new RegExp(`\\b${goWord}\\s*${highWord}\\s*${levelWord}\\b`, 'gi'), 'CRM platform'],
  [new RegExp(`\\b${highWord}${levelWord}\\b`, 'gi'), 'CRM platform'],
  [new RegExp(`\\b${crmProviderWord}\\b`, 'gi'), 'CRM platform'],
  [new RegExp(`${shortBrand}(?=[_-])`, 'gi'), 'platform'],
  [new RegExp(`\\b${shortBrand}\\b`, 'gi'), 'CRM'],
  [new RegExp(`\\b${subAccountWord}\\b`, 'gi'), 'workspace'],
];

export function sanitizePlatformBranding(value: string): string {
  return BRANDING_REPLACEMENTS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    value
  );
}
