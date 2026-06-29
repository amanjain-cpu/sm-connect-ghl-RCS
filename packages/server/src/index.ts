// ===========================================
// Signalmash Connect - API Server Entry Point
// ===========================================

import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';
import { apiRoutes } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { startOutboundMessageWorker, stopOutboundMessageWorker } from './queues/outbound-message.queue.js';
import { startIncomingEventsWorker, stopIncomingEventsWorker } from './queues/incoming-events.queue.js';

const app: Express = express();
const crmMarketplaceHostnames = [
  ['go', 'high', 'level'].join(''),
  ['lead', 'connector', 'hq'].join(''),
] as const;
const crmMarketplaceOriginPatterns = crmMarketplaceHostnames.map(
  (hostname) => new RegExp(`\\.${hostname}\\.com$`)
);
const crmMarketplaceFrameAncestors = crmMarketplaceHostnames.map(
  (hostname) => `https://*.${hostname}.com`
);

function buildAllowedOrigins(): Array<string | RegExp> {
  const origins = new Set<string>();

  origins.add(config.webUrl);

  try {
    const webUrl = new URL(config.webUrl);
    const host = webUrl.hostname;

    if (host.startsWith('www.')) {
      const bareHost = host.slice(4);
      origins.add(`${webUrl.protocol}//${bareHost}`);
    } else {
      origins.add(`${webUrl.protocol}//www.${host}`);
    }
  } catch {
    // Keep the configured URL only if parsing fails.
  }

  return [
    ...origins,
    ...crmMarketplaceOriginPatterns,
  ];
}

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Allow iframe embedding for the CRM marketplace shell
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      frameSrc: ["'self'"],
      frameAncestors: ["'self'", ...crmMarketplaceFrameAncestors],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: buildAllowedOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Request parsing
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    (req as express.Request).rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim()),
  },
  skip: (req) => req.url === '/api/health',
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => (
    req.path === '/auth/refresh' ||
    req.path === '/platforms/crm/sso/exchange' ||
    req.path === '/platforms/leadconnector/sso/exchange'
  ),
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
});

app.use('/api', limiter);

// API Routes
app.use('/api', apiRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  await stopOutboundMessageWorker();
  logger.info('Outbound message worker closed');

  await stopIncomingEventsWorker();
  logger.info('Incoming events worker closed');

  // Close database connection
  await prisma.$disconnect();
  logger.info('Database connection closed');

  // Close Redis connection
  await redis.quit();
  logger.info('Redis connection closed');

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const PORT = config.port;

app.listen(PORT, () => {
  startOutboundMessageWorker();
  startIncomingEventsWorker();
  logger.info(`🚀 Signalmash Connect API running on port ${PORT}`);
  logger.info(`📚 Environment: ${config.nodeEnv}`);
  logger.info(`🌐 API URL: ${config.apiUrl}`);
  logger.info(`💻 Web URL: ${config.webUrl}`);
});

export { app };
