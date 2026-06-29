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
  '2fa': 'Two-Factor Authentication',
  account_notifications: 'Account Notifications',
  customer_care: 'Customer Care',
  delivery_notifications: 'Delivery Notifications',
  fraud_alerts: 'Fraud Alerts',
  higher_education: 'Higher Education',
  low_volume: 'Low Volume Mixed',
  marketing: 'Marketing',
  mixed: 'Mixed',
  polling_voting: 'Polling & Voting',
  public_service_announcement: 'Public Service Announcement',
  security_alerts: 'Security Alerts',
};

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
