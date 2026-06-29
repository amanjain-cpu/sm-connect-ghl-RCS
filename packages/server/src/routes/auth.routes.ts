// ===========================================
// Authentication Routes
// ===========================================

import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { validate, passwordSchema, emailSchema } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  clearAuthCookies,
  getRefreshTokenFromRequest,
  setAuthCookies,
} from '../utils/auth-cookies.js';
import { UnauthorizedError } from '../utils/errors.js';

const router: RouterType = Router();

// Validation schemas
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  organizationName: z.string().min(1, 'Organization name is required').max(100),
  phone: z.string().optional(),
  website: z.string().url().optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

/**
 * POST /auth/register
 * Register a new user and organization
 */
router.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    setAuthCookies(req, res, result.tokens);

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

/**
 * POST /auth/login
 * Login user
 */
router.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    setAuthCookies(req, res, result.tokens);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * POST /auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  validate({ body: refreshTokenSchema }),
  asyncHandler(async (req, res) => {
    const refreshToken = req.body.refreshToken ?? getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    const tokens = await authService.refreshToken(refreshToken);
    setAuthCookies(req, res, tokens);

    res.json({
      success: true,
      data: tokens,
    });
  })
);

/**
 * POST /auth/logout
 * Logout user (invalidate refresh token)
 */
router.post(
  '/logout',
  validate({ body: refreshTokenSchema }),
  asyncHandler(async (req, res) => {
    const refreshToken = req.body.refreshToken ?? getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    await authService.logout(refreshToken);
    clearAuthCookies(req, res);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  })
);

/**
 * POST /auth/logout-all
 * Logout from all devices
 */
router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user!.id);
    clearAuthCookies(req, res);

    res.json({
      success: true,
      message: 'Logged out from all devices',
    });
  })
);

/**
 * POST /auth/change-password
 * Change user password
 */
router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.changePassword(
      req.user!.id,
      req.body.currentPassword,
      req.body.newPassword
    );

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  })
);

/**
 * GET /auth/me
 * Get current user info
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        user: req.user,
      },
    });
  })
);

export { router as authRoutes };
