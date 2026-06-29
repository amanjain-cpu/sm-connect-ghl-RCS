// ===========================================
// Authentication Service
// ===========================================

import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { generateTokenPair, verifyRefreshToken } from '../utils/jwt.js';
import {
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SALT_ROUNDS = 12;

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName: string;
  phone?: string;
  website?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface AuthResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    organizationId: string;
    embeddedLocationId?: string;
    embeddedInstallationId?: string | null;
  };
  organization: {
    id: string;
    name: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

interface EmbeddedSessionContext {
  locationId?: string;
  installationId?: string | null;
}

export class AuthService {
  private async ensureEmbeddedSessionStillLinked(input: {
    organizationId: string;
    embeddedInstallationId?: unknown;
    embeddedLocationId?: unknown;
  }) {
    if (
      typeof input.embeddedInstallationId !== 'string' &&
      typeof input.embeddedLocationId !== 'string'
    ) {
      return;
    }

    const installation = typeof input.embeddedInstallationId === 'string'
      ? await prisma.platformInstallation.findFirst({
          where: {
            id: input.embeddedInstallationId,
            organizationId: input.organizationId,
          },
          select: {
            externalAccountId: true,
            status: true,
          },
        })
      : await prisma.platformInstallation.findFirst({
          where: {
            organizationId: input.organizationId,
            platform: 'leadconnector',
            externalAccountId: input.embeddedLocationId as string,
          },
          select: {
            externalAccountId: true,
            status: true,
          },
        });

    if (
      !installation ||
      installation.status !== 'connected' ||
      (
        typeof input.embeddedLocationId === 'string' &&
        installation.externalAccountId !== input.embeddedLocationId
      )
    ) {
      throw new UnauthorizedError(
        'Embedded app session is no longer active for this connected workspace'
      );
    }
  }

  /**
   * Register a new user and organization
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const { email, password, firstName, lastName, organizationName, phone, website } = input;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError('An account with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create organization and user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create organization
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          email: email.toLowerCase(),
          phone,
          website,
        },
      });

      // Create user as owner
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          firstName,
          lastName,
          role: 'owner',
          organizationId: organization.id,
        },
      });

      return { user, organization };
    });

    // Generate tokens
    const tokens = await generateTokenPair({
      userId: result.user.id,
      organizationId: result.organization.id,
      email: result.user.email,
      role: result.user.role,
    });

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: result.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    logger.info({ userId: result.user.id }, 'User registered successfully');

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        organizationId: result.organization.id,
      },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
      },
      tokens,
    };
  }

  /**
   * Login user
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const { email, password } = input;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        organization: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate tokens
    const tokens = await generateTokenPair({
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      role: user.role,
    });

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    logger.info({ userId: user.id }, 'User logged in successfully');

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
      },
      tokens,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    // Verify the refresh token
    const decoded = await verifyRefreshToken(refreshToken);

    // Check if token exists in database
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedError('Refresh token has expired');
    }

    try {
      await this.ensureEmbeddedSessionStillLinked({
        organizationId: storedToken.user.organizationId,
        embeddedInstallationId: decoded.embeddedInstallationId,
        embeddedLocationId: decoded.embeddedLocationId,
      });
    } catch (error) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw error;
    }

    // Delete old token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    // Generate new tokens
    const tokens = await generateTokenPair({
      userId: storedToken.user.id,
      organizationId: storedToken.user.organizationId,
      email: storedToken.user.email,
      role: storedToken.user.role,
      ...(typeof decoded.embeddedLocationId === 'string'
        ? { embeddedLocationId: decoded.embeddedLocationId }
        : {}),
      ...(typeof decoded.embeddedInstallationId === 'string'
        ? { embeddedInstallationId: decoded.embeddedInstallationId }
        : {}),
    });

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: storedToken.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return tokens;
  }

  /**
   * Logout - invalidate refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    logger.info({ userId }, 'User logged out from all devices');
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isValidPassword) {
      throw new BadRequestError('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Invalidate all refresh tokens
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    logger.info({ userId }, 'Password changed successfully');
  }

  /**
   * Login via OAuth/SSO (no password required)
   * Used when a user authenticates via the embedded CRM OAuth flow
   */
  async loginViaOAuth(
    organizationId: string,
    context: EmbeddedSessionContext = {}
  ): Promise<AuthResult> {
    // Find or create a default user for this organization
    let user = await prisma.user.findFirst({
      where: { organizationId },
      include: { organization: true },
    });

    if (!user) {
      // Get organization details
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new NotFoundError('Organization not found');
      }

      // Create a default user for the organization
      // Generate a random password hash (user won't need it for SSO)
      const randomPassword = await bcrypt.hash(
        Math.random().toString(36).slice(-16),
        SALT_ROUNDS
      );

      user = await prisma.user.create({
        data: {
          email: organization.email,
          passwordHash: randomPassword,
          firstName: organization.name.split(' ')[0] || 'User',
          lastName: organization.name.split(' ').slice(1).join(' ') || '',
          role: 'owner',
          organizationId: organization.id,
        },
        include: { organization: true },
      });

      logger.info({ userId: user.id, organizationId }, 'Created user via OAuth');
    }

    // Generate tokens
    const tokens = await generateTokenPair({
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      role: user.role,
      ...(context.locationId ? { embeddedLocationId: context.locationId } : {}),
      ...(context.installationId ? { embeddedInstallationId: context.installationId } : {}),
    });

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    logger.info({ userId: user.id }, 'User logged in via OAuth');

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        ...(context.locationId ? { embeddedLocationId: context.locationId } : {}),
        ...(context.installationId ? { embeddedInstallationId: context.installationId } : {}),
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
      },
      tokens,
    };
  }

  /**
   * Get user by organization (for SSO re-authentication)
   */
  async getUserByOrganization(organizationId: string) {
    const user = await prisma.user.findFirst({
      where: { organizationId },
      include: { organization: true },
    });

    return user;
  }
}

export const authService = new AuthService();
