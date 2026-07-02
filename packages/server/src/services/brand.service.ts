// ===========================================
// Brand Registration Service
// ===========================================

import { prisma } from '../config/database.js';
import {
  BUSINESS_VERTICAL_TO_SIGNALMASH_PROVIDER_VERTICAL,
  SIGNALMASH_PROVIDER_VERTICALS,
  type SignalmashProviderVertical,
} from '@signalmash-connect/shared';
import { signalmashService } from './signalmash.service.js';
import { NotFoundError, BadRequestError, ConflictError, AppError, ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { Brand, BrandStatus, EntityType, BusinessVertical, BrandRelationship } from '@prisma/client';
import { integrationService } from './integration.service.js';
import { providerOperationService } from './provider-operation.service.js';

interface CreateBrandInput {
  organizationId: string;
  legalName: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  ein?: string;
  einIssuingCountry?: string;
  entityType: EntityType;
  providerEntityType?: string;
  vertical: BusinessVertical;
  providerVertical?: string;
  brandRelationship?: BrandRelationship;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  website: string;
  phone: string;
  mobilePhone?: string;
  email: string;
  businessContactEmail?: string;
  stockSymbol?: string;
  stockExchange?: string;
  ipAddress?: string;
  altBusinessId?: string;
  altBusinessIdType?: string;
  referenceId?: string;
  tags?: string[];
}

interface UpdateBrandInput {
  legalName?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  ein?: string;
  einIssuingCountry?: string;
  entityType?: EntityType;
  providerEntityType?: string;
  vertical?: BusinessVertical;
  providerVertical?: string;
  brandRelationship?: BrandRelationship;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  website?: string;
  phone?: string;
  mobilePhone?: string;
  email?: string;
  businessContactEmail?: string;
  stockSymbol?: string;
  stockExchange?: string;
  ipAddress?: string;
  altBusinessId?: string;
  altBusinessIdType?: string;
  referenceId?: string;
  tags?: string[];
}

export class BrandService {
  private mapEntityTypeToProvider(entityType: EntityType): string {
    const map: Record<EntityType, string> = {
      sole_proprietor: 'SOLE_PROPRIETOR',
      partnership: 'PARTNERSHIP',
      corporation: 'PRIVATE_PROFIT',
      llc: 'LLC',
      non_profit: 'NON_PROFIT',
      government: 'GOVERNMENT',
    };

    return map[entityType];
  }

  private mapVerticalToProvider(vertical: BusinessVertical): SignalmashProviderVertical {
    const providerVertical = BUSINESS_VERTICAL_TO_SIGNALMASH_PROVIDER_VERTICAL[vertical];
    if (!providerVertical) {
      throw new BadRequestError('Select a specific Signalmash provider vertical before submitting this brand');
    }

    return providerVertical;
  }

  private resolveProviderVertical(brand: Pick<Brand, 'vertical' | 'providerVertical'>): SignalmashProviderVertical {
    if (brand.providerVertical) {
      if (brand.providerVertical === 'PROFESSIONAL_SERVICES') {
        return 'PROFESSIONAL';
      }

      if (brand.providerVertical === 'OTHER') {
        const mapped = BUSINESS_VERTICAL_TO_SIGNALMASH_PROVIDER_VERTICAL[brand.vertical];
        if (mapped) {
          return mapped;
        }

        throw new BadRequestError('Select a specific Signalmash provider vertical before submitting this brand');
      }

      if (SIGNALMASH_PROVIDER_VERTICALS.includes(brand.providerVertical as SignalmashProviderVertical)) {
        return brand.providerVertical as SignalmashProviderVertical;
      }

      throw new BadRequestError('Select a supported Signalmash provider vertical before submitting this brand');
    }

    return this.mapVerticalToProvider(brand.vertical);
  }

  private assertBrandReadyForSubmission(brand: Brand) {
    if (!brand.legalName.trim()) {
      throw new BadRequestError('Legal name is required before submitting this brand');
    }

    if (!brand.displayName.trim()) {
      throw new BadRequestError('Display name is required before submitting this brand');
    }

    if (brand.entityType !== 'sole_proprietor' && !brand.ein?.trim()) {
      throw new BadRequestError('Tax ID / EIN is required before submitting this brand');
    }

    if (
      !brand.streetAddress.trim() ||
      !brand.city.trim() ||
      !brand.state.trim() ||
      !brand.postalCode.trim() ||
      !brand.country.trim()
    ) {
      throw new BadRequestError('Business address is required before submitting this brand');
    }

    if (!brand.website.trim() || !brand.phone.trim() || !brand.email.trim()) {
      throw new BadRequestError('Website, phone, and email are required before submitting this brand');
    }

    if (!brand.businessContactEmail?.trim()) {
      throw new BadRequestError('Business contact email is required before submitting this brand');
    }
  }

  private buildProviderPayload(brand: Brand) {
    const providerVertical = this.resolveProviderVertical(brand);

    return {
      entityType: brand.providerEntityType ?? this.mapEntityTypeToProvider(brand.entityType),
      firstName: brand.firstName ?? undefined,
      lastName: brand.lastName ?? undefined,
      displayName: brand.displayName,
      companyName: brand.legalName,
      ein: brand.ein ?? undefined,
      einIssuingCountry: brand.einIssuingCountry ?? brand.country,
      phone: brand.phone,
      street: brand.streetAddress,
      city: brand.city,
      state: brand.state,
      postalCode: brand.postalCode,
      country: brand.country,
      email: brand.email,
      stockSymbol: brand.stockSymbol ?? undefined,
      stockExchange: brand.stockExchange ?? undefined,
      ipAddress: brand.ipAddress ?? undefined,
      brandRelationship: brand.brandRelationship ?? 'BASIC_ACCOUNT',
      website: brand.website,
      vertical: providerVertical,
      altBusinessId: brand.altBusinessId ?? undefined,
      altBusinessIdType: brand.altBusinessIdType ?? undefined,
      referenceId: brand.referenceId ?? undefined,
      tag: brand.tags as string[],
      mobilePhone: brand.mobilePhone ?? undefined,
      businessContactEmail: brand.businessContactEmail ?? brand.email,
    };
  }

  /**
   * Create a new brand (draft status)
   */
  async create(data: CreateBrandInput): Promise<Brand> {
    // Check if organization already has a brand with same legal name
    const existingBrand = await prisma.brand.findFirst({
      where: {
        organizationId: data.organizationId,
        legalName: data.legalName,
      },
    });

    if (existingBrand) {
      throw new ConflictError('A brand with this legal name already exists');
    }

    const brand = await prisma.brand.create({
      data: {
        ...data,
        country: data.country ?? 'US',
        providerEntityType: data.providerEntityType ?? null,
        providerVertical: data.providerVertical ?? null,
        tags: data.tags ?? [],
        status: 'draft',
      },
    });

    logger.info({ brandId: brand.id }, 'Brand created');

    return brand;
  }

  /**
   * Get brand by ID
   */
  async getById(id: string, organizationId: string): Promise<Brand> {
    const brand = await prisma.brand.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!brand) {
      throw new NotFoundError('Brand not found');
    }

    return brand;
  }

  /**
   * Get all brands for an organization
   */
  async getByOrganization(organizationId: string): Promise<Brand[]> {
    return prisma.brand.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update brand (only allowed for draft or unverified status)
   */
  async update(
    id: string,
    organizationId: string,
    data: UpdateBrandInput
  ): Promise<Brand> {
    const brand = await this.getById(id, organizationId);

    if (!['draft', 'unverified', 'rejected'].includes(brand.status)) {
      throw new BadRequestError('Cannot update brand in current status');
    }

    return prisma.brand.update({
      where: { id },
      data: {
        ...data,
        // Reset status if significant changes are made
        status: brand.status === 'rejected' ? 'draft' : brand.status,
        rejectionReason: brand.status === 'rejected' ? null : brand.rejectionReason,
      },
    });
  }

  /**
   * Submit brand for verification
   */
  async submitForVerification(id: string, organizationId: string): Promise<Brand> {
    const brand = await this.getById(id, organizationId);

    if (!['draft', 'unverified', 'rejected'].includes(brand.status)) {
      throw new BadRequestError('Brand cannot be submitted in its current state');
    }

    const installation = await integrationService.getPrimaryInstallationForOrganization(organizationId);
    if (!installation || installation.status !== 'connected') {
      throw new BadRequestError('Connect your GHL workspace before submitting a brand');
    }

    this.assertBrandReadyForSubmission(brand);
    const requestPayload = this.buildProviderPayload(brand);

    await prisma.brand.update({
      where: { id: brand.id },
      data: {
        providerVertical: requestPayload.vertical,
        submitAttempts: {
          increment: 1,
        },
        lastSubmittedAt: new Date(),
        lastSubmissionError: null,
        providerMessage: null,
      },
    });

    try {
      const result = await signalmashService.registerBrand(requestPayload);
      const nextStatus = this.mapProviderBrandStatus(result.status, 'pending_verification');

      const updatedBrand = await prisma.brand.update({
        where: { id: brand.id },
        data: {
          signalmashBrandId: result.brandId,
          tcrBrandId: result.tcrBrandId ?? brand.tcrBrandId,
          status: nextStatus,
          providerVertical: requestPayload.vertical,
          providerStatus: result.status,
          providerMessage: result.message ?? null,
          verificationScore: result.verificationScore ?? brand.verificationScore,
          rejectionReason: nextStatus === 'rejected' ? brand.rejectionReason : null,
          lastSubmissionError: null,
          lastStatusSyncedAt: new Date(),
        },
      });

      await integrationService.syncBrandMapping(updatedBrand);
      await integrationService.setPrimaryOnboardingResources(organizationId, {
        installationId: installation.id,
        brandId: updatedBrand.id,
      });

      await providerOperationService.log({
        organizationId,
        installationId: installation.id,
        operation: 'submit_brand',
        localResourceType: 'Brand',
        localResourceId: updatedBrand.id,
        externalId: updatedBrand.signalmashBrandId,
        status: 'success',
        requestPayload,
        responsePayload: result as unknown as Record<string, unknown>,
      });

      return updatedBrand;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown provider submission failure';

      await prisma.brand.update({
        where: { id: brand.id },
        data: {
          lastSubmissionError: errorMessage,
          providerMessage: errorMessage,
        },
      });

      await providerOperationService.log({
        organizationId,
        installationId: installation.id,
        operation: 'submit_brand',
        localResourceType: 'Brand',
        localResourceId: brand.id,
        externalId: brand.signalmashBrandId,
        status: 'failed',
        requestPayload,
        errorMessage,
      });

      if (error instanceof ExternalServiceError) {
        throw new AppError(
          'Unable to submit the brand to Signalmash right now.',
          'PROVIDER_BRAND_SUBMISSION_FAILED',
          502,
          true,
          {
            provider: 'signalmash',
            operation: 'submit_brand',
            brandId: brand.id,
            upstreamMessage: error.message,
          }
        );
      }

      throw error;
    }
  }

  /**
   * Handle verification webhook from Signalmash
   */
  async handleVerificationResult(
    signalmashBrandId: string,
    status: string,
    verificationScore?: number,
    rejectionReason?: string,
    tcrBrandId?: string
  ): Promise<Brand> {
    const brand = await prisma.brand.findFirst({
      where: { signalmashBrandId },
    });

    if (!brand) {
      throw new NotFoundError('Brand not found');
    }

    const nextStatus = this.mapProviderBrandStatus(status, brand.status);
    const updatedBrand = await prisma.brand.update({
      where: { id: brand.id },
      data: {
        status: nextStatus,
        providerStatus: status,
        providerMessage: rejectionReason ?? null,
        verificationScore,
        rejectionReason: nextStatus === 'rejected' ? rejectionReason ?? brand.rejectionReason : null,
        tcrBrandId: tcrBrandId ?? brand.tcrBrandId,
        lastStatusSyncedAt: new Date(),
        lastSubmissionError:
          nextStatus === 'rejected' ? rejectionReason ?? brand.lastSubmissionError : null,
      },
    });

    logger.info(
      { brandId: brand.id, providerStatus: status, nextStatus, verificationScore },
      'Brand verification status updated'
    );

    await integrationService.syncBrandMapping(updatedBrand);
    await providerOperationService.log({
      organizationId: brand.organizationId,
      operation: 'brand_webhook',
      localResourceType: 'Brand',
      localResourceId: brand.id,
      externalId: signalmashBrandId,
      status: 'success',
      responsePayload: {
        status,
        nextStatus,
        verificationScore,
        rejectionReason,
        tcrBrandId,
      },
    });

    return updatedBrand;
  }

  async refreshVerificationStatus(id: string, organizationId: string): Promise<Brand> {
    const brand = await this.getById(id, organizationId);

    if (!brand.signalmashBrandId) {
      throw new BadRequestError('Brand has not been submitted to Signalmash yet');
    }

    try {
      const providerStatus = await signalmashService.getBrandStatus(brand.signalmashBrandId);
      const nextStatus = this.mapProviderBrandStatus(providerStatus.status, brand.status);

      const updatedBrand = await prisma.brand.update({
        where: { id: brand.id },
        data: {
          status: nextStatus,
          providerStatus: providerStatus.status,
          providerMessage:
            providerStatus.rejectionReason ??
            providerStatus.providerMessage ??
            brand.providerMessage,
          verificationScore: providerStatus.verificationScore ?? brand.verificationScore,
          rejectionReason:
            nextStatus === 'rejected'
              ? providerStatus.rejectionReason ?? brand.rejectionReason
              : null,
          tcrBrandId: providerStatus.tcrBrandId ?? brand.tcrBrandId,
          referenceId: providerStatus.referenceId ?? brand.referenceId,
          lastStatusSyncedAt: new Date(),
          lastSubmissionError:
            nextStatus === 'rejected'
              ? providerStatus.rejectionReason ?? brand.lastSubmissionError
              : null,
        },
      });

      logger.info(
        {
          brandId: brand.id,
          signalmashBrandId: brand.signalmashBrandId,
          providerStatus: providerStatus.status,
          nextStatus,
          tcrBrandId: updatedBrand.tcrBrandId,
        },
        'Brand verification status refreshed from Signalmash'
      );

      await integrationService.syncBrandMapping(updatedBrand);
      await providerOperationService.log({
        organizationId,
        operation: 'refresh_brand_status',
        localResourceType: 'Brand',
        localResourceId: brand.id,
        externalId: brand.signalmashBrandId,
        status: 'success',
        responsePayload: providerStatus as unknown as Record<string, unknown>,
      });

      return updatedBrand;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown provider refresh failure';
      await providerOperationService.log({
        organizationId,
        operation: 'refresh_brand_status',
        localResourceType: 'Brand',
        localResourceId: brand.id,
        externalId: brand.signalmashBrandId,
        status: 'failed',
        errorMessage,
      });

      if (error instanceof ExternalServiceError) {
        throw new AppError(
          'Unable to refresh brand status from Signalmash right now.',
          'PROVIDER_STATUS_REFRESH_FAILED',
          503,
          true,
          {
            provider: 'signalmash',
            operation: 'refresh_brand_status',
            brandId: brand.id,
            signalmashBrandId: brand.signalmashBrandId,
            upstreamMessage: error.message,
          }
        );
      }

      throw error;
    }
  }

  async setManualVerificationStatus(
    id: string,
    organizationId: string,
    status: Extract<BrandStatus, 'verified' | 'rejected'>,
    reason?: string
  ): Promise<Brand> {
    const brand = await this.getById(id, organizationId);

    if (!brand.signalmashBrandId) {
      throw new BadRequestError('Brand must be linked to Signalmash before admin approval can be set');
    }

    const normalizedReason = reason?.trim() || undefined;
    const rejectionReason =
      status === 'rejected'
        ? normalizedReason ??
          brand.rejectionReason ??
          brand.providerMessage ??
          brand.lastSubmissionError ??
          'Marked rejected manually by admin.'
        : null;

    const updatedBrand = await prisma.brand.update({
      where: { id: brand.id },
      data: {
        status,
        rejectionReason,
        lastSubmissionError: status === 'rejected' ? rejectionReason : null,
      },
    });

    logger.info(
      {
        brandId: brand.id,
        signalmashBrandId: brand.signalmashBrandId,
        previousStatus: brand.status,
        nextStatus: status,
      },
      'Brand verification status updated manually'
    );

    await integrationService.syncBrandMapping(updatedBrand);

    return updatedBrand;
  }

  private mapProviderBrandStatus(providerStatus: string, currentStatus: BrandStatus): BrandStatus {
    const normalized = providerStatus.trim().replace(/[\s-]+/g, '_').toLowerCase();

    if (['active', 'verified', 'approved', 'vetted_verified'].includes(normalized)) {
      return 'verified';
    }

    if (['rejected', 'declined', 'failed'].includes(normalized)) {
      return 'rejected';
    }

    if (['suspended'].includes(normalized)) {
      return 'suspended';
    }

    if (
      [
        'self_declared',
        'unverified',
        'needs_info',
        'pending',
        'pending_verification',
        'in_review',
        'submitted',
        'review',
        'manual_review',
      ].includes(normalized)
    ) {
      return 'pending_verification';
    }

    return currentStatus;
  }

  /**
   * Delete brand (only draft brands)
   */
  async delete(id: string, organizationId: string): Promise<void> {
    const brand = await this.getById(id, organizationId);

    if (brand.status !== 'draft') {
      throw new BadRequestError('Only draft brands can be deleted');
    }

    await prisma.brand.delete({
      where: { id },
    });

    logger.info({ brandId: id }, 'Brand deleted');
  }

  /**
   * Get brand with campaigns
   */
  async getWithCampaigns(id: string, organizationId: string): Promise<Brand & {
    campaigns: Array<{
      id: string;
      name: string;
      status: string;
      useCase: string;
    }>;
  }> {
    const brand = await prisma.brand.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        campaigns: {
          select: {
            id: true,
            name: true,
            status: true,
            useCase: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!brand) {
      throw new NotFoundError('Brand not found');
    }

    return brand;
  }
}

export const brandService = new BrandService();
