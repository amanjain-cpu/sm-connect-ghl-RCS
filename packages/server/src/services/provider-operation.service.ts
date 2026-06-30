import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { integrationService } from './integration.service.js';

interface ProviderOperationInput {
  organizationId: string;
  installationId?: string | null;
  operation: string;
  localResourceType?: string;
  localResourceId?: string;
  externalId?: string | null;
  status: 'success' | 'failed';
  requestPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
}

export class ProviderOperationService {
  async log(input: ProviderOperationInput) {
    const installationId =
      input.installationId ??
      (await integrationService.getPrimaryInstallationForOrganization(input.organizationId))?.id ??
      null;

    return prisma.providerOperationLog.create({
      data: {
        organizationId: input.organizationId,
        installationId,
        operation: input.operation,
        localResourceType: input.localResourceType,
        localResourceId: input.localResourceId,
        externalId: input.externalId ?? undefined,
        status: input.status,
        requestPayload: input.requestPayload as Prisma.InputJsonValue | undefined,
        responsePayload: input.responsePayload as Prisma.InputJsonValue | undefined,
        errorMessage: input.errorMessage ?? undefined,
      },
    });
  }
}

export const providerOperationService = new ProviderOperationService();
