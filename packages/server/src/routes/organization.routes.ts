// ===========================================
// Organization Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { organizationService } from '../services/organization.service.js';
import { validate, emailSchema } from '../middleware/validation.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router: RouterType = Router();

// Validation schemas
const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: emailSchema.optional(),
  phone: z.string().max(20).optional(),
  website: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
});

/**
 * GET /organization
 * Get current organization details
 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const organization = await organizationService.getWithDetails(
      req.user!.organizationId
    );

    // Remove sensitive data from users
    const sanitizedUsers = organization.users.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatarUrl: user.avatarUrl,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }));

    res.json({
      success: true,
      data: {
        ...organization,
        users: sanitizedUsers,
      },
    });
  })
);

/**
 * PUT /organization
 * Update organization
 */
router.put(
  '/',
  authenticate,
  requireRole('owner', 'admin'),
  validate({ body: updateOrganizationSchema }),
  asyncHandler(async (req, res) => {
    const organization = await organizationService.update(
      req.user!.organizationId,
      req.body
    );

    res.json({
      success: true,
      data: organization,
    });
  })
);

/**
 * GET /organization/stats
 * Get organization statistics
 */
router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req, res) => {
    const stats = await organizationService.getStats(req.user!.organizationId);

    res.json({
      success: true,
      data: stats,
    });
  })
);

router.get(
  '/dashboard',
  authenticate,
  asyncHandler(async (req, res) => {
    const summary = await organizationService.getDashboardSummary(req.user!.organizationId);

    res.json({
      success: true,
      data: summary,
    });
  })
);

/**
 * GET /organization/users
 * Get organization users
 */
router.get(
  '/users',
  authenticate,
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const users = await organizationService.getUsers(req.user!.organizationId);

    res.json({
      success: true,
      data: users,
    });
  })
);

export { router as organizationRoutes };
