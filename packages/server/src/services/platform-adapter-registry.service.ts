// ===========================================
// Platform Adapter Registry
// ===========================================

import type { IntegrationPlatform, PlatformAdapter } from '@signalmash-connect/shared';
import { crmPlatformAdapter } from '../adapters/crm-platform.adapter.js';

class PlatformAdapterRegistryService {
  private readonly adapters = new Map<IntegrationPlatform, PlatformAdapter>([
    [crmPlatformAdapter.platform, crmPlatformAdapter],
  ]);

  get(platform: IntegrationPlatform): PlatformAdapter {
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      throw new Error(`No platform adapter registered for ${platform}`);
    }

    return adapter;
  }

  has(platform: IntegrationPlatform): boolean {
    return this.adapters.has(platform);
  }
}

export const platformAdapterRegistry = new PlatformAdapterRegistryService();
