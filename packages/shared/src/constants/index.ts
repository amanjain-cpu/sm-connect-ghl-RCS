// ===========================================
// Signalmash Connect - Constants
// ===========================================

export const PLATFORMS = {
  CRM: 'leadconnector',
  SHOPIFY: 'shopify',
  HUBSPOT: 'hubspot',
  SALESFORCE: 'salesforce',
  ZOHO: 'zoho',
} as const;

export const PLATFORM_NAMES: Record<string, string> = {
  leadconnector: 'CRM Platform',
  shopify: 'Shopify',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  zoho: 'Zoho',
};

export const BRAND_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_verification: 'Pending Verification',
  verified: 'Verified',
  unverified: 'Unverified',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  expired: 'Expired',
};

export const CAMPAIGN_USE_CASES: Record<string, string> = {
  two_factor_auth: 'Two-Factor Authentication',
  account_notifications: 'Account Notifications',
  customer_care: 'Customer Care',
  delivery_notifications: 'Delivery Notifications',
  fraud_alerts: 'Fraud Alerts',
  higher_education: 'Higher Education',
  low_volume: 'Low Volume',
  marketing: 'Marketing',
  mixed: 'Mixed',
  polling_voting: 'Polling & Voting',
  public_service_announcement: 'Public Service Announcement',
  security_alerts: 'Security Alerts',
};

export const CAMPAIGN_USE_CASE_DESCRIPTIONS: Record<string, string> = {
  marketing: 'Promotional messages, offers, and outreach.',
  customer_care: 'Support, follow-up, and service conversations.',
  account_notifications: 'Security, billing, and account alerts.',
  delivery_notifications: 'Shipment, dispatch, and delivery updates.',
  fraud_alerts: 'Sensitive notices related to fraud prevention.',
  higher_education: 'Institutional messaging for schools and programs.',
  low_volume: 'Small-scale operational messaging with one or more sub-use-cases.',
  mixed: 'A mix of standard operational or promotional use cases.',
  polling_voting: 'Surveys, feedback, and voting campaigns.',
  public_service_announcement: 'Broad public-awareness communications.',
  security_alerts: 'Security-related warnings and notifications.',
  two_factor_auth: 'One-time passcodes and verification flows.',
};

export const CAMPAIGN_USE_CASE_VALUES = [
  'two_factor_auth',
  'account_notifications',
  'customer_care',
  'delivery_notifications',
  'fraud_alerts',
  'higher_education',
  'low_volume',
  'marketing',
  'mixed',
  'polling_voting',
  'public_service_announcement',
  'security_alerts',
] as const;

export const CAMPAIGN_SUB_USE_CASE_VALUES = [
  'two_factor_auth',
  'account_notifications',
  'customer_care',
  'delivery_notifications',
  'fraud_alerts',
  'higher_education',
  'marketing',
  'polling_voting',
  'public_service_announcement',
  'security_alerts',
] as const;

export const CAMPAIGN_USE_CASES_REQUIRING_SUB_USE_CASES = [
  'low_volume',
  'mixed',
] as const;

export const ENTITY_TYPES: Record<string, string> = {
  sole_proprietor: 'Sole Proprietor',
  partnership: 'Partnership',
  corporation: 'Corporation',
  llc: 'Limited Liability Company (LLC)',
  non_profit: 'Non-Profit',
  government: 'Government',
};

export const BUSINESS_VERTICALS: Record<string, string> = {
  retail: 'Retail',
  healthcare: 'Healthcare',
  financial: 'Financial Services',
  education: 'Education',
  hospitality: 'Hospitality',
  real_estate: 'Real Estate',
  technology: 'Technology',
  professional_services: 'Professional Services',
  other: 'Other',
};

export const SIGNALMASH_PROVIDER_VERTICALS = [
  'PROFESSIONAL',
  'REAL_ESTATE',
  'HEALTHCARE',
  'HUMAN_RESOURCES',
  'ENERGY',
  'RETAIL',
  'TRANSPORTATION',
  'AGRICULTURE',
  'INSURANCE',
  'POSTAL',
  'EDUCATION',
  'HOSPITALITY',
  'FINANCIAL',
  'POLITICAL',
  'GAMBLING',
  'LEGAL',
  'CONSTRUCTION',
  'NGO',
  'MANUFACTURING',
  'GOVERNMENT',
  'TECHNOLOGY',
  'COMMUNICATION',
] as const;

export type SignalmashProviderVertical = (typeof SIGNALMASH_PROVIDER_VERTICALS)[number];

export const SIGNALMASH_PROVIDER_VERTICAL_LABELS: Record<SignalmashProviderVertical, string> = {
  PROFESSIONAL: 'Professional Services',
  REAL_ESTATE: 'Real Estate',
  HEALTHCARE: 'Healthcare and Life Sciences',
  HUMAN_RESOURCES: 'HR, Staffing or Recruitment',
  ENERGY: 'Energy and Utilities',
  RETAIL: 'Retail and Consumer Products',
  TRANSPORTATION: 'Transportation or Logistics',
  AGRICULTURE: 'Agriculture',
  INSURANCE: 'Insurance',
  POSTAL: 'Postal and Delivery',
  EDUCATION: 'Education',
  HOSPITALITY: 'Hospitality and Travel',
  FINANCIAL: 'Financial Services',
  POLITICAL: 'Political',
  GAMBLING: 'Gambling and Lottery',
  LEGAL: 'Legal',
  CONSTRUCTION: 'Construction, Materials, and Trade Services',
  NGO: 'Non-profit Organization',
  MANUFACTURING: 'Manufacturing',
  GOVERNMENT: 'Government Services and Agencies',
  TECHNOLOGY: 'Information Technology Services',
  COMMUNICATION: 'Media and Communication',
};

export const SIGNALMASH_PROVIDER_VERTICAL_TO_BUSINESS_VERTICAL: Record<
  SignalmashProviderVertical,
  keyof typeof BUSINESS_VERTICALS
> = {
  PROFESSIONAL: 'professional_services',
  REAL_ESTATE: 'real_estate',
  HEALTHCARE: 'healthcare',
  HUMAN_RESOURCES: 'other',
  ENERGY: 'other',
  RETAIL: 'retail',
  TRANSPORTATION: 'other',
  AGRICULTURE: 'other',
  INSURANCE: 'other',
  POSTAL: 'other',
  EDUCATION: 'education',
  HOSPITALITY: 'hospitality',
  FINANCIAL: 'financial',
  POLITICAL: 'other',
  GAMBLING: 'other',
  LEGAL: 'professional_services',
  CONSTRUCTION: 'other',
  NGO: 'other',
  MANUFACTURING: 'other',
  GOVERNMENT: 'other',
  TECHNOLOGY: 'technology',
  COMMUNICATION: 'other',
};

export const BUSINESS_VERTICAL_TO_SIGNALMASH_PROVIDER_VERTICAL: Partial<
  Record<keyof typeof BUSINESS_VERTICALS, SignalmashProviderVertical>
> = {
  retail: 'RETAIL',
  healthcare: 'HEALTHCARE',
  financial: 'FINANCIAL',
  education: 'EDUCATION',
  hospitality: 'HOSPITALITY',
  real_estate: 'REAL_ESTATE',
  technology: 'TECHNOLOGY',
  professional_services: 'PROFESSIONAL',
};

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  undelivered: 'Undelivered',
  received: 'Received',
};

export const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

// API Rate Limits
export const RATE_LIMITS = {
  DEFAULT: {
    windowMs: 60 * 1000, // 1 minute
    max: 100,
  },
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
  },
  MESSAGES: {
    windowMs: 1000, // 1 second
    max: 10,
  },
};

// Pagination Defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

// Token Expiry
export const TOKEN_EXPIRY = {
  ACCESS_TOKEN: '15m',
  REFRESH_TOKEN: '7d',
  OAUTH_STATE: '10m',
};
