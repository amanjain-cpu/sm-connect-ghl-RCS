// ===========================================
// Server Configuration
// ===========================================

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();
const crmApiDomainDefault = `https://services.${['lead', 'connector', 'hq'].join('')}.com`;

const configSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3001),
  apiUrl: z.string().url().default('http://localhost:3001'),
  webUrl: z.string().url().default('http://localhost:5173'),

  // Database
  databaseUrl: z.string(),

  // Redis
  redisUrl: z.string().default('redis://localhost:6379'),

  // JWT & Security
  jwtSecret: z.string().min(32),
  jwtRefreshSecret: z.string().min(32),
  sessionSecret: z.string().min(32),
  encryptionKey: z.string().length(32),

  // Signalmash (uses API Token only - get from portal.signalmash.com/#/api/tokens)
  signalmashApiUrl: z.string().url().default('https://api.signalmash.com'),
  signalmashApiKey: z.string().optional(),

  // SimplyRCS (RCS messaging; SMS fallback stays on Signalmash). Runtime settings override these.
  simplyrcsApiUrl: z.string().url().default('https://simplyrcs.signalmash.com'),
  simplyrcsApiKey: z.string().optional(),
  simplyrcsWebhookSecret: z.string().optional(),

  // Stripe
  stripeSecretKey: z.string().optional(),
  stripeWebhookSecret: z.string().optional(),
  stripePriceStarterMonthly: z.string().optional(),
  stripePriceGrowthMonthly: z.string().optional(),
  stripePriceScaleMonthly: z.string().optional(),

  // CRM marketplace app credentials
  ghlAppClientId: z.string().optional(),
  ghlAppClientSecret: z.string().optional(),
  ghlAppSsoKey: z.string().optional(),
  ghlAppCustomPageLinkId: z.string().optional(),
  ghlApiDomain: z.string().url().default(crmApiDomainDefault),
  ghlWebhookSecret: z.string().optional(),
  ghlWebhookPublicKey: z.string().optional(),
  ghlWebhookLegacyPublicKey: z.string().optional(),

  // Shopify (Future)
  shopifyApiKey: z.string().optional(),
  shopifyApiSecret: z.string().optional(),

  // HubSpot (Future)
  hubspotClientId: z.string().optional(),
  hubspotClientSecret: z.string().optional(),

  // Salesforce (Future)
  salesforceClientId: z.string().optional(),
  salesforceClientSecret: z.string().optional(),

  // Zoho (Future)
  zohoClientId: z.string().optional(),
  zohoClientSecret: z.string().optional(),

  // Email
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  fromEmail: z.string().email().optional(),

  // Support Agent
  supportAgentApiUrl: z.string().url().optional(),
  supportAgentWidgetUrl: z.string().url().optional(),
  supportAgentAdminApiKey: z.string().optional(),

  // Sentry
  sentryDsn: z.string().optional(),
});

function loadConfig() {
  const rawConfig = {
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    apiUrl: process.env['API_URL'],
    webUrl: process.env['WEB_URL'],

    databaseUrl: process.env['DATABASE_URL'],
    redisUrl: process.env['REDIS_URL'],

    jwtSecret: process.env['JWT_SECRET'],
    jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'],
    sessionSecret: process.env['SESSION_SECRET'],
    encryptionKey: process.env['ENCRYPTION_KEY'],

    signalmashApiUrl: process.env['SIGNALMASH_API_URL'],
    signalmashApiKey: process.env['SIGNALMASH_API_KEY'],
    simplyrcsApiUrl: process.env['SIMPLYRCS_API_URL'],
    simplyrcsApiKey: process.env['SIMPLYRCS_API_KEY'],
    simplyrcsWebhookSecret: process.env['SIMPLYRCS_WEBHOOK_SECRET'],

    stripeSecretKey: process.env['STRIPE_SECRET_KEY'],
    stripeWebhookSecret: process.env['STRIPE_WEBHOOK_SECRET'],
    stripePriceStarterMonthly: process.env['STRIPE_PRICE_STARTER_MONTHLY'],
    stripePriceGrowthMonthly: process.env['STRIPE_PRICE_GROWTH_MONTHLY'],
    stripePriceScaleMonthly: process.env['STRIPE_PRICE_SCALE_MONTHLY'],

    ghlAppClientId: process.env['CRM_APP_CLIENT_ID'] ?? process.env['GHL_APP_CLIENT_ID'],
    ghlAppClientSecret: process.env['CRM_APP_CLIENT_SECRET'] ?? process.env['GHL_APP_CLIENT_SECRET'],
    ghlAppSsoKey: process.env['CRM_APP_SSO_KEY'] ?? process.env['GHL_APP_SSO_KEY'],
    ghlAppCustomPageLinkId: process.env['CRM_APP_CUSTOM_PAGE_LINK_ID'] ?? process.env['GHL_APP_CUSTOM_PAGE_LINK_ID'],
    ghlApiDomain: process.env['CRM_API_DOMAIN'] ?? process.env['GHL_API_DOMAIN'],
    ghlWebhookSecret: process.env['CRM_WEBHOOK_SECRET'] ?? process.env['GHL_WEBHOOK_SECRET'],
    ghlWebhookPublicKey: process.env['CRM_WEBHOOK_PUBLIC_KEY'] ?? process.env['GHL_WEBHOOK_PUBLIC_KEY'],
    ghlWebhookLegacyPublicKey: process.env['CRM_WEBHOOK_LEGACY_PUBLIC_KEY'] ?? process.env['GHL_WEBHOOK_LEGACY_PUBLIC_KEY'],

    shopifyApiKey: process.env['SHOPIFY_API_KEY'],
    shopifyApiSecret: process.env['SHOPIFY_API_SECRET'],

    hubspotClientId: process.env['HUBSPOT_CLIENT_ID'],
    hubspotClientSecret: process.env['HUBSPOT_CLIENT_SECRET'],

    salesforceClientId: process.env['SALESFORCE_CLIENT_ID'],
    salesforceClientSecret: process.env['SALESFORCE_CLIENT_SECRET'],

    zohoClientId: process.env['ZOHO_CLIENT_ID'],
    zohoClientSecret: process.env['ZOHO_CLIENT_SECRET'],

    smtpHost: process.env['SMTP_HOST'],
    smtpPort: process.env['SMTP_PORT'],
    smtpUser: process.env['SMTP_USER'],
    smtpPass: process.env['SMTP_PASS'],
    fromEmail: process.env['FROM_EMAIL'],

    supportAgentApiUrl: process.env['SUPPORT_AGENT_API_URL'],
    supportAgentWidgetUrl: process.env['SUPPORT_AGENT_WIDGET_URL'],
    supportAgentAdminApiKey: process.env['SUPPORT_AGENT_ADMIN_API_KEY'],

    sentryDsn: process.env['SENTRY_DSN'],
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('❌ Invalid configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export type Config = z.infer<typeof configSchema>;
