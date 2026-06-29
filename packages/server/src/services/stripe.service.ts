import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { adminService, SETTINGS_KEYS } from './admin.service.js';

export interface StripeCheckoutSession {
  id: string;
  url?: string | null;
  status?: string | null;
  payment_status?: string | null;
  customer?: string | null;
  subscription?: string | null;
  mode?: 'payment' | 'subscription' | 'setup' | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  current_period_start?: number | null;
  current_period_end?: number | null;
  latest_invoice?: string | { id?: string | null } | null;
  default_payment_method?: string | { id?: string | null } | null;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      id: string;
      price?: {
        id?: string | null;
      } | null;
    }>;
  } | null;
}

export interface StripeCustomer {
  id: string;
  email?: string | null;
  name?: string | null;
  invoice_settings?: {
    default_payment_method?: string | { id?: string | null } | null;
  } | null;
}

export interface StripePrice {
  id: string;
  unit_amount?: number | null;
  currency: string;
}

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  last_payment_error?: {
    message?: string | null;
  } | null;
}

export interface StripeInvoiceItem {
  id: string;
  invoice?: string | null;
}

export interface StripeEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  data: {
    object: T;
  };
}

type StripeRequestBody =
  | URLSearchParams
  | undefined;

function bodyToString(body: StripeRequestBody) {
  if (!body) {
    return undefined;
  }

  return body.toString();
}

export class StripeService {
  private async getSecretKey(): Promise<string> {
    const value = await adminService.getSettingWithFallback(
      SETTINGS_KEYS.STRIPE_SECRET_KEY,
      config.stripeSecretKey
    );

    if (!value) {
      throw new AppError('Stripe billing is not configured', 'STRIPE_NOT_CONFIGURED', 503);
    }

    return value;
  }

  async getWebhookSecret(): Promise<string> {
    const value = await adminService.getSettingWithFallback(
      SETTINGS_KEYS.STRIPE_WEBHOOK_SECRET,
      config.stripeWebhookSecret
    );

    if (!value) {
      throw new AppError(
        'Stripe webhook signing secret is not configured',
        'STRIPE_WEBHOOK_NOT_CONFIGURED',
        503
      );
    }

    return value;
  }

  async getPlanPriceId(plan: 'starter' | 'growth' | 'scale'): Promise<string> {
    const keyByPlan = {
      starter: SETTINGS_KEYS.STRIPE_PRICE_STARTER_MONTHLY,
      growth: SETTINGS_KEYS.STRIPE_PRICE_GROWTH_MONTHLY,
      scale: SETTINGS_KEYS.STRIPE_PRICE_SCALE_MONTHLY,
    } as const;

    const fallbackByPlan = {
      starter: config.stripePriceStarterMonthly,
      growth: config.stripePriceGrowthMonthly,
      scale: config.stripePriceScaleMonthly,
    } as const;

    return adminService.getSettingWithFallback(keyByPlan[plan], fallbackByPlan[plan]);
  }

  private async callStripe<T>(path: string, init: RequestInit = {}): Promise<T> {
    const secretKey = await this.getSecretKey();
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(init.headers || {}),
      },
      body: bodyToString(init.body as StripeRequestBody),
    });

    const body = await response.json().catch(() => ({})) as {
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new AppError(
        body.error?.message || 'Stripe request failed',
        'STRIPE_ERROR',
        502,
        true,
        { status: response.status, path }
      );
    }

    return body as T;
  }

  async createCustomer(input: {
    organizationId: string;
    email: string;
    name: string;
  }): Promise<StripeCustomer> {
    const body = new URLSearchParams();
    body.set('email', input.email);
    body.set('name', input.name);
    body.set('metadata[organizationId]', input.organizationId);

    return this.callStripe<StripeCustomer>('/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async getCustomer(customerId: string): Promise<StripeCustomer> {
    return this.callStripe<StripeCustomer>(`/customers/${encodeURIComponent(customerId)}`, {
      method: 'GET',
    });
  }

  async createSubscriptionCheckoutSession(input: {
    organizationId: string;
    customerId?: string | null;
    customerEmail: string;
    customerName: string;
    plan: 'starter' | 'growth' | 'scale';
    unitAmountCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeCheckoutSession> {
    const body = new URLSearchParams();
    body.set('mode', 'subscription');
    body.set('success_url', input.successUrl);
    body.set('cancel_url', input.cancelUrl);
    body.set('client_reference_id', input.organizationId);
    body.set('metadata[organizationId]', input.organizationId);
    body.set('metadata[plan]', input.plan);
    body.set('subscription_data[metadata][organizationId]', input.organizationId);
    body.set('subscription_data[metadata][plan]', input.plan);
    body.set('subscription_data[payment_settings][save_default_payment_method]', 'on_subscription');
    body.set('line_items[0][quantity]', '1');

    const priceId = await this.getPlanPriceId(input.plan);

    if (priceId) {
      body.set('line_items[0][price]', priceId);
    } else {
      body.set('line_items[0][price_data][currency]', 'usd');
      body.set('line_items[0][price_data][unit_amount]', String(input.unitAmountCents));
      body.set('line_items[0][price_data][recurring][interval]', 'month');
      body.set('line_items[0][price_data][product_data][name]', `Signalmash Connect ${input.plan}`);
      body.set(
        'line_items[0][price_data][product_data][description]',
        'Signalmash Connect monthly subscription'
      );
    }

    if (input.customerId) {
      body.set('customer', input.customerId);
    } else {
      body.set('customer_email', input.customerEmail);
    }

    return this.callStripe<StripeCheckoutSession>('/checkout/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async createOneTimeCheckoutSession(input: {
    organizationId: string;
    customerId?: string | null;
    customerEmail: string;
    customerName: string;
    amountCents: number;
    successUrl: string;
    cancelUrl: string;
    description: string;
    metadata: Record<string, string>;
  }): Promise<StripeCheckoutSession> {
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('success_url', input.successUrl);
    body.set('cancel_url', input.cancelUrl);
    body.set('client_reference_id', input.organizationId);
    body.set('line_items[0][quantity]', '1');
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
    body.set('line_items[0][price_data][product_data][name]', input.description);
    body.set('line_items[0][price_data][product_data][description]', input.description);

    for (const [key, value] of Object.entries(input.metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    if (input.customerId) {
      body.set('customer', input.customerId);
    } else {
      body.set('customer_email', input.customerEmail);
      body.set('customer_creation', 'always');
    }

    return this.callStripe<StripeCheckoutSession>('/checkout/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async getCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
    return this.callStripe<StripeCheckoutSession>(
      `/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET' }
    );
  }

  async getSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return this.callStripe<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: 'GET' }
    );
  }

  async getPrice(priceId: string): Promise<StripePrice> {
    return this.callStripe<StripePrice>(`/prices/${encodeURIComponent(priceId)}`, {
      method: 'GET',
    });
  }

  async updateSubscriptionPlan(input: {
    subscriptionId: string;
    subscriptionItemId: string;
    plan: 'starter' | 'growth' | 'scale';
  }): Promise<StripeSubscription> {
    const priceId = await this.getPlanPriceId(input.plan);
    if (!priceId) {
      throw new AppError(
        'Stripe plan price IDs are required before changing existing subscriptions',
        'STRIPE_PLAN_PRICE_NOT_CONFIGURED',
        503
      );
    }

    const body = new URLSearchParams();
    body.set('items[0][id]', input.subscriptionItemId);
    body.set('items[0][price]', priceId);
    body.set('metadata[plan]', input.plan);
    body.set('proration_behavior', 'create_prorations');

    return this.callStripe<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }
    );
  }

  async createOffSessionPayment(input: {
    customerId: string;
    paymentMethodId?: string | null;
    amountCents: number;
    description: string;
    metadata: Record<string, string>;
  }): Promise<StripePaymentIntent> {
    const body = new URLSearchParams();
    body.set('amount', String(input.amountCents));
    body.set('currency', 'usd');
    body.set('customer', input.customerId);
    body.set('confirm', 'true');
    body.set('off_session', 'true');
    body.set('description', input.description);

    if (input.paymentMethodId) {
      body.set('payment_method', input.paymentMethodId);
    }

    for (const [key, value] of Object.entries(input.metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    return this.callStripe<StripePaymentIntent>('/payment_intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const body = new URLSearchParams();
    body.set('customer', input.customerId);
    body.set('return_url', input.returnUrl);

    return this.callStripe<{ url: string }>('/billing_portal/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async createInvoiceItem(input: {
    customerId: string;
    invoiceId: string;
    unitAmountCents: number;
    quantity: number;
    description: string;
    metadata: Record<string, string>;
  }): Promise<StripeInvoiceItem> {
    const body = new URLSearchParams();
    body.set('customer', input.customerId);
    body.set('invoice', input.invoiceId);
    body.set('currency', 'usd');
    body.set('unit_amount', String(input.unitAmountCents));
    body.set('quantity', String(input.quantity));
    body.set('description', input.description);

    for (const [key, value] of Object.entries(input.metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    return this.callStripe<StripeInvoiceItem>('/invoiceitems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async verifyWebhookEvent(payload: string, signatureHeader: string | undefined): Promise<StripeEvent> {
    if (!signatureHeader) {
      throw new AppError('Missing Stripe signature header', 'STRIPE_SIGNATURE_MISSING', 401);
    }

    const secret = await this.getWebhookSecret();
    const parts = signatureHeader.split(',').map((part) => part.trim());
    const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
    const signature = parts.find((part) => part.startsWith('v1='))?.slice(3);

    if (!timestamp || !signature) {
      throw new AppError('Malformed Stripe signature header', 'STRIPE_SIGNATURE_INVALID', 401);
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`, 'utf8')
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      throw new AppError('Invalid Stripe signature', 'STRIPE_SIGNATURE_INVALID', 401);
    }

    return JSON.parse(payload) as StripeEvent;
  }
}

export const stripeService = new StripeService();
