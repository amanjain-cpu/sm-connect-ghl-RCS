// ===========================================
// Authentication Middleware
// ===========================================

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { prisma } from '../config/database.js';
import type { UserRole } from '@prisma/client';
import { getAccessTokenFromRequest } from '../utils/auth-cookies.js';

// User info attached to authenticated requests
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  organizationId: string;
  embeddedLocationId?: string;
  embeddedInstallationId?: string;
}

// Authenticated request type
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      rawBody?: string;
    }
  }
}

/**
 * Authenticate user via JWT token
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = getAccessTokenFromRequest(req);

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }
    const decoded = await verifyAccessToken(token);

    if (
      typeof decoded.embeddedInstallationId === 'string' ||
      typeof decoded.embeddedLocationId === 'string'
    ) {
      const installation = typeof decoded.embeddedInstallationId === 'string'
        ? await prisma.platformInstallation.findFirst({
            where: {
              id: decoded.embeddedInstallationId,
              organizationId: decoded.organizationId,
            },
            select: {
              id: true,
              externalAccountId: true,
              status: true,
            },
          })
        : await prisma.platformInstallation.findFirst({
            where: {
              organizationId: decoded.organizationId,
              platform: 'leadconnector',
              externalAccountId: decoded.embeddedLocationId as string,
            },
            select: {
              id: true,
              externalAccountId: true,
              status: true,
            },
          });

      if (
        !installation ||
        installation.status !== 'connected' ||
        (
          typeof decoded.embeddedLocationId === 'string' &&
          installation.externalAccountId !== decoded.embeddedLocationId
        )
      ) {
        throw new UnauthorizedError(
          'Embedded app session is no longer active for this connected workspace'
        );
      }
    }

    // Verify user still exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organizationId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    req.user = {
      ...user,
      ...(typeof decoded.embeddedLocationId === 'string'
        ? { embeddedLocationId: decoded.embeddedLocationId }
        : {}),
      ...(typeof decoded.embeddedInstallationId === 'string'
        ? { embeddedInstallationId: decoded.embeddedInstallationId }
        : {}),
    };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require specific roles
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = getAccessTokenFromRequest(req);

    if (!token) {
      return next();
    }
    const decoded = await verifyAccessToken(token);

    if (
      typeof decoded.embeddedInstallationId === 'string' ||
      typeof decoded.embeddedLocationId === 'string'
    ) {
      const installation = typeof decoded.embeddedInstallationId === 'string'
        ? await prisma.platformInstallation.findFirst({
            where: {
              id: decoded.embeddedInstallationId,
              organizationId: decoded.organizationId,
            },
            select: {
              id: true,
              externalAccountId: true,
              status: true,
            },
          })
        : await prisma.platformInstallation.findFirst({
            where: {
              organizationId: decoded.organizationId,
              platform: 'leadconnector',
              externalAccountId: decoded.embeddedLocationId as string,
            },
            select: {
              id: true,
              externalAccountId: true,
              status: true,
            },
          });

      if (
        !installation ||
        installation.status !== 'connected' ||
        (
          typeof decoded.embeddedLocationId === 'string' &&
          installation.externalAccountId !== decoded.embeddedLocationId
        )
      ) {
        return next();
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organizationId: true,
      },
    });

    if (user) {
      req.user = {
        ...user,
        ...(typeof decoded.embeddedLocationId === 'string'
          ? { embeddedLocationId: decoded.embeddedLocationId }
          : {}),
        ...(typeof decoded.embeddedInstallationId === 'string'
          ? { embeddedInstallationId: decoded.embeddedInstallationId }
          : {}),
      };
    }

    next();
  } catch {
    // Silently continue without auth
    next();
  }
}
