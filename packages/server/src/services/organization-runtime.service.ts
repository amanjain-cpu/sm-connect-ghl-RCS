import { prisma } from '../config/database.js';
import { AppError } from '../utils/errors.js';

export class OrganizationRuntimeService {
  async getState(organizationId: string) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        status: true,
        suspendedAt: true,
        suspensionReason: true,
        billingAccount: {
          select: {
            status: true,
            suspendedAt: true,
            suspensionReason: true,
          },
        },
      },
    });

    if (!organization) {
      throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
    }

    return organization;
  }

  async assertActionAllowed(
    organizationId: string,
    action: string,
  ) {
    const organization = await this.getState(organizationId);

    if (organization.status === 'suspended') {
      throw new AppError(
        organization.suspensionReason || `This organization is suspended and cannot ${action} right now.`,
        'ORGANIZATION_SUSPENDED',
        403,
        true,
        {
          action,
          suspendedAt: organization.suspendedAt?.toISOString() ?? null,
        }
      );
    }

    if (organization.billingAccount?.status === 'suspended') {
      throw new AppError(
        organization.billingAccount.suspensionReason ||
          `Billing is suspended and this organization cannot ${action} right now.`,
        'BILLING_SUSPENDED',
        402,
        true,
        {
          action,
          suspendedAt: organization.billingAccount.suspendedAt?.toISOString() ?? null,
        }
      );
    }

    return organization;
  }
}

export const organizationRuntimeService = new OrganizationRuntimeService();
