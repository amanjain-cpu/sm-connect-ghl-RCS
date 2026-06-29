# Signalmash Connect - Complete Project Reference

> **Last Updated:** April 14, 2026
> **Purpose:** Complete project context for AI assistants and developers

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Directory Structure](#directory-structure)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)
7. [Frontend Pages & Routes](#frontend-pages--routes)
8. [Authentication Flow](#authentication-flow)
9. [Platform Integrations](#platform-integrations)
10. [Key Features](#key-features)
11. [Environment Variables](#environment-variables)
12. [Running the Project](#running-the-project)
13. [Deployment](#deployment)
14. [Important Implementation Details](#important-implementation-details)
15. [Known Issues & TODOs](#known-issues--todos)

---

## Project Overview

**Signalmash Connect** is a multi-platform marketplace application that integrates with CRM marketplace platform and Signalmash APIs to provide SMS/MMS messaging capabilities for CRM sub-accounts.

### Core Value Proposition
- CRM users can connect their sub-accounts to Signalmash for A2P 10DLC compliant messaging
- Users can register brands, create campaigns, purchase phone numbers (DIDs)
- Messages sent through CRM are routed via Signalmash for delivery
- Provides a unified dashboard for managing all messaging operations

### Business Flow
1. User installs the app from CRM marketplace
2. User authenticates via CRM SSO (OAuth)
3. System creates/links organization from CRM location data
4. User registers their brand for 10DLC compliance
5. User creates campaigns and gets them approved
6. User purchases phone numbers and assigns to campaigns
7. User can send/receive SMS/MMS through the platform

---

## Tech Stack

### Backend (packages/server)
- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL with Prisma ORM
- **Cache:** Redis (ioredis)
- **Authentication:** JWT tokens, CRM OAuth
- **Validation:** Zod schemas
- **Logging:** Pino logger
- **Build:** TSX for development, TSC for production

### Frontend (packages/web)
- **Framework:** React 18 with TypeScript
- **Routing:** React Router v6
- **State Management:** Zustand stores
- **Styling:** Tailwind CSS + shadcn/ui components
- **Animations:** Framer Motion
- **Build:** Vite
- **Icons:** Lucide React

### Shared (packages/shared)
- Common TypeScript types and interfaces
- Shared utilities and constants

### Infrastructure
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx
- **SSL:** Let's Encrypt (Certbot)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│                     http://localhost:5173                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend API (Express)                        │
│                     http://localhost:3001                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Routes    │  │  Services   │  │  Adapters   │              │
│  │  /api/*     │──│  Business   │──│  External   │              │
│  │             │  │   Logic     │  │    APIs     │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
         │                   │                    │
         ▼                   ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  PostgreSQL │      │    Redis    │      │  External   │
│  (Prisma)   │      │   (Cache)   │      │    APIs     │
└─────────────┘      └─────────────┘      └─────────────┘
                                                 │
                           ┌─────────────────────┼─────────────────────┐
                           ▼                     ▼                     ▼
                    ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
                    │     CRM     │       │  Signalmash │       │   TCR API   │
                    │    OAuth    │       │   SMS API   │       │  (10DLC)    │
                    └─────────────┘       └─────────────┘       └─────────────┘
```

---

## Directory Structure

```
signalmash-connect/
├── packages/
│   ├── server/                      # Backend Express API
│   │   ├── src/
│   │   │   ├── adapters/           # External API adapters
│   │   │   │   ├── base.adapter.ts
│   │   │   │   ├── crm-platform.adapter.ts  # CRM platform API
│   │   │   │   └── index.ts
│   │   │   ├── config/             # Configuration
│   │   │   │   ├── database.ts     # Prisma client
│   │   │   │   ├── redis.ts        # Redis client
│   │   │   │   └── env.ts          # Environment config
│   │   │   ├── middleware/         # Express middleware
│   │   │   │   ├── auth.ts         # JWT authentication
│   │   │   │   ├── validation.ts   # Zod validation
│   │   │   │   └── errorHandler.ts
│   │   │   ├── routes/             # API routes
│   │   │   │   ├── index.ts        # Route aggregator
│   │   │   │   ├── auth.routes.ts
│   │   │   │   ├── brand.routes.ts
│   │   │   │   ├── campaign.routes.ts
│   │   │   │   ├── message.routes.ts
│   │   │   │   ├── phoneNumber.routes.ts
│   │   │   │   ├── platform.routes.ts
│   │   │   │   ├── webhook.routes.ts
│   │   │   │   ├── organization.routes.ts
│   │   │   │   └── admin.routes.ts
│   │   │   ├── services/           # Business logic
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── brand.service.ts
│   │   │   │   ├── campaign.service.ts
│   │   │   │   ├── message.service.ts
│   │   │   │   ├── phoneNumber.service.ts
│   │   │   │   ├── platform.service.ts
│   │   │   │   ├── signalmash.service.ts
│   │   │   │   ├── webhook.service.ts
│   │   │   │   └── admin.service.ts
│   │   │   ├── utils/              # Utilities
│   │   │   │   ├── encryption.ts   # AES encryption for secrets
│   │   │   │   └── logger.ts       # Pino logger
│   │   │   └── index.ts            # App entry point
│   │   ├── prisma/
│   │   │   └── schema.prisma       # Database schema
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                         # Frontend React app
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── layout/         # Layout components
│   │   │   │   │   ├── app-layout.tsx
│   │   │   │   │   ├── sidebar.tsx
│   │   │   │   │   └── header.tsx
│   │   │   │   └── ui/             # UI components (shadcn-style)
│   │   │   │       ├── button.tsx
│   │   │   │       ├── input.tsx
│   │   │   │       ├── card.tsx
│   │   │   │       ├── badge.tsx
│   │   │   │       ├── avatar.tsx
│   │   │   │       ├── dialog.tsx
│   │   │   │       ├── select.tsx
│   │   │   │       ├── label.tsx
│   │   │   │       ├── dropdown-menu.tsx
│   │   │   │       └── theme-toggle.tsx
│   │   │   ├── pages/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── connect.tsx     # CRM SSO login
│   │   │   │   │   └── callback.tsx    # OAuth callback
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── index.tsx
│   │   │   │   ├── brands/
│   │   │   │   │   ├── index.tsx       # Brand list
│   │   │   │   │   ├── new.tsx         # Create brand
│   │   │   │   │   └── [id].tsx        # Brand detail
│   │   │   │   ├── campaigns/
│   │   │   │   │   ├── index.tsx       # Campaign list
│   │   │   │   │   ├── new.tsx         # Create campaign
│   │   │   │   │   └── [id].tsx        # Campaign detail
│   │   │   │   ├── phone-numbers/
│   │   │   │   │   ├── index.tsx       # Phone number list
│   │   │   │   │   └── search-dialog.tsx # Search & purchase
│   │   │   │   ├── messages/
│   │   │   │   │   └── index.tsx
│   │   │   │   ├── platforms/
│   │   │   │   │   └── index.tsx       # Platform connections
│   │   │   │   ├── settings/
│   │   │   │   │   └── index.tsx
│   │   │   │   └── admin/              # Admin panel
│   │   │   │       ├── login.tsx
│   │   │   │       ├── setup.tsx
│   │   │   │       ├── dashboard.tsx
│   │   │   │       ├── settings.tsx
│   │   │   │       └── organizations.tsx
│   │   │   ├── stores/             # Zustand stores
│   │   │   │   ├── auth.store.ts   # User auth state
│   │   │   │   ├── admin.store.ts  # Admin auth state
│   │   │   │   └── theme.store.ts  # Theme preferences
│   │   │   ├── lib/
│   │   │   │   ├── api.ts          # API client
│   │   │   │   └── utils.ts        # Utilities (cn, formatNumber)
│   │   │   ├── styles/
│   │   │   │   └── globals.css     # Tailwind + custom styles
│   │   │   ├── App.tsx             # Main app with routes
│   │   │   └── main.tsx            # Entry point
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   └── tsconfig.json
│   │
│   └── shared/                      # Shared types
│       └── src/
│           ├── types/
│           └── index.ts
│
├── deploy/                          # Deployment files
│   ├── DEPLOYMENT.md               # Deployment guide
│   ├── setup-vps.sh               # Initial VPS setup
│   ├── deploy.sh                  # Update deployment
│   └── nginx.conf                 # Nginx config template
│
├── ecosystem.config.cjs            # PM2 configuration
├── package.json                    # Root package.json
├── pnpm-workspace.yaml            # PNPM workspace config
├── tsconfig.json                  # Root TypeScript config
└── PROJECT_REFERENCE.md           # This file
```

---

## Database Schema

### Core Models

#### Organization
```prisma
model Organization {
  id              String    @id @default(uuid())
  name            String
  signalmashOrgId String?   // Linked Signalmash org
  apiKey          String?   // Signalmash API key (encrypted)
  status          OrgStatus @default(active)

  // Relations
  users           User[]
  brands          Brand[]
  campaigns       Campaign[]
  phoneNumbers    PhoneNumber[]
  platformConnections PlatformConnection[]
}
```

#### User
```prisma
model User {
  id             String    @id @default(uuid())
  email          String    @unique
  firstName      String
  lastName       String
  role           UserRole  @default(member)
  organizationId String

  // CRM-specific fields
  ghlUserId      String?   @unique
  ghlLocationId  String?
}
```

#### Brand (10DLC)
```prisma
model Brand {
  id                String      @id @default(uuid())
  organizationId    String
  name              String
  displayName       String
  companyName       String
  ein               String?     // Tax ID
  einIssuingCountry String?
  website           String?
  vertical          String      // Business category
  entityType        String      // PRIVATE_PROFIT, etc.
  status            BrandStatus @default(pending)
  tcrBrandId        String?     // TCR registration ID

  // Contact info
  street            String?
  city              String?
  state             String?
  postalCode        String?
  country           String
  email             String
  phone             String

  campaigns         Campaign[]
}
```

#### Campaign (10DLC)
```prisma
model Campaign {
  id               String         @id @default(uuid())
  organizationId   String
  brandId          String
  name             String
  description      String?
  usecase          String         // MARKETING, CUSTOMER_CARE, etc.
  status           CampaignStatus @default(pending)
  tcrCampaignId    String?        // TCR registration ID

  // Sample messages (required for 10DLC)
  sampleMessages   String[]
  messageFlow      String?
  helpMessage      String?
  optinMessage     String?
  optoutMessage    String?

  phoneNumbers     PhoneNumber[]
  messages         Message[]
}
```

#### PhoneNumber (DID)
```prisma
model PhoneNumber {
  id                 String            @id @default(uuid())
  organizationId     String
  campaignId         String?
  phoneNumber        String            @unique  // E.164 format
  formattedNumber    String
  friendlyName       String?
  areaCode           String?
  smsCapable         Boolean           @default(true)
  mmsCapable         Boolean           @default(false)
  voiceCapable       Boolean           @default(false)
  status             PhoneNumberStatus @default(pending)
  signalmashNumberId String?           // Signalmash DID ID
  monthlyPrice       Decimal?
  setupPrice         Decimal?

  messages           Message[]
}
```

#### Message
```prisma
model Message {
  id              String          @id @default(uuid())
  organizationId  String
  campaignId      String?
  phoneNumberId   String?
  direction       MessageDirection // inbound/outbound
  from            String
  to              String
  body            String?
  mediaUrls       String[]
  status          MessageStatus
  signalmashMsgId String?
  errorCode       String?
  errorMessage    String?
  price           Decimal?
  segments        Int             @default(1)

  sentAt          DateTime?
  deliveredAt     DateTime?
}
```

#### PlatformConnection
```prisma
model PlatformConnection {
  id              String    @id @default(uuid())
  organizationId  String
  platform        Platform  // CRM, etc.
  platformAccountId String  // CRM location ID
  accessToken     String    // Encrypted
  refreshToken    String?   // Encrypted
  tokenExpiresAt  DateTime?
  isActive        Boolean   @default(true)
  metadata        Json?     // Platform-specific data
}
```

#### AppSettings (Admin)
```prisma
model AppSettings {
  id          String   @id @default(uuid())
  key         String   @unique
  value       String
  description String?
  isEncrypted Boolean  @default(false)
  updatedBy   String?
}

// Important keys:
// - GHL_CLIENT_ID
// - GHL_CLIENT_SECRET (encrypted)
// - SIGNALMASH_API_KEY (encrypted)
// - ADMIN_PASSWORD_HASH
```

---

## API Endpoints

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/me` | Get current user |
| POST | `/logout` | Logout user |
| POST | `/refresh` | Refresh JWT token |

### Platforms (`/api/platforms`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List connected platforms |
| GET | `/:platform/oauth` | Get OAuth URL (CRM) |
| GET | `/:platform/callback` | OAuth callback handler |
| DELETE | `/:platform` | Disconnect platform |

### Brands (`/api/brands`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List brands |
| POST | `/` | Create brand |
| GET | `/:id` | Get brand details |
| PATCH | `/:id` | Update brand |
| DELETE | `/:id` | Delete brand |
| POST | `/:id/submit` | Submit to TCR |

### Campaigns (`/api/campaigns`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List campaigns |
| POST | `/` | Create campaign |
| GET | `/:id` | Get campaign details |
| PATCH | `/:id` | Update campaign |
| DELETE | `/:id` | Delete campaign |
| POST | `/:id/submit` | Submit to TCR |

### Phone Numbers (`/api/phone-numbers`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/available` | Search available numbers |
| GET | `/stats` | Get phone number stats |
| GET | `/` | List org's numbers |
| GET | `/:id` | Get number details |
| POST | `/purchase` | Purchase a number |
| PATCH | `/:id` | Update number |
| DELETE | `/:id` | Release number |

### Messages (`/api/messages`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List messages |
| GET | `/stats` | Get message stats |
| GET | `/:id` | Get message details |
| POST | `/send` | Send SMS/MMS |

### Webhooks (`/api/webhooks`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/signalmash` | Signalmash webhook receiver |
| POST | `/webhook` | CRM webhook receiver |

### Admin (`/api/admin`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/login` | Admin login |
| POST | `/logout` | Admin logout |
| GET | `/me` | Get admin session |
| GET | `/setup/status` | Check if setup complete |
| POST | `/setup` | Initial admin setup |
| GET | `/settings` | Get app settings |
| POST | `/settings` | Create setting |
| PATCH | `/settings/:key` | Update setting |
| DELETE | `/settings/:key` | Delete setting |
| GET | `/organizations` | List all organizations |
| GET | `/stats` | Get system stats |

---

## Frontend Pages & Routes

### Public Routes
| Path | Component | Description |
|------|-----------|-------------|
| `/connect` | ConnectPage | CRM SSO login page |
| `/auth/callback` | AuthCallbackPage | OAuth callback handler |

### Protected Routes (User)
| Path | Component | Description |
|------|-----------|-------------|
| `/dashboard` | DashboardPage | Main dashboard |
| `/brands` | BrandsPage | Brand list |
| `/brands/new` | NewBrandPage | Create brand form |
| `/brands/:id` | BrandDetailPage | Brand details |
| `/campaigns` | CampaignsPage | Campaign list |
| `/campaigns/new` | NewCampaignPage | Create campaign form |
| `/campaigns/:id` | CampaignDetailPage | Campaign details |
| `/phone-numbers` | PhoneNumbersPage | DID management |
| `/messages` | MessagesPage | Message history |
| `/platforms` | PlatformsPage | Platform connections |
| `/settings` | SettingsPage | User settings |

### Admin Routes
| Path | Component | Description |
|------|-----------|-------------|
| `/admin/login` | AdminLoginPage | Admin login |
| `/admin/setup` | AdminSetupPage | Initial setup wizard |
| `/admin/dashboard` | AdminDashboardPage | Admin dashboard |
| `/admin/settings` | AdminSettingsPage | App settings (CRM creds) |
| `/admin/organizations` | AdminOrganizationsPage | Manage orgs |

---

## Authentication Flow

### CRM SSO Flow
```
1. User clicks "Connect with CRM platform" on /connect
2. Frontend calls GET /api/platforms/:platform/oauth
3. Backend:
   - Generates state token (UUID)
   - Stores state in oauth_states table with expiry
   - Returns CRM OAuth URL with:
     - client_id (from AppSettings)
     - redirect_uri
     - scope (contacts.readonly conversations/message.write locations.readonly)
     - state token
4. User redirects to CRM OAuth consent screen
5. User approves, CRM redirects to /auth/callback?code=xxx&state=xxx
6. Frontend sends code+state to GET /api/platforms/:platform/callback
7. Backend:
   - Validates state token
   - Exchanges code for tokens with CRM
   - Fetches location info from CRM
   - Creates/updates organization
   - Creates/updates user
   - Creates PlatformConnection
   - Generates JWT token
8. Frontend stores JWT, redirects to /dashboard
```

### JWT Token Structure
```typescript
{
  userId: string,
  organizationId: string,
  email: string,
  role: 'admin' | 'member'
}
```

### Admin Authentication
- Separate from user auth
- Uses password stored in AppSettings (hashed with bcrypt)
- Initial setup creates admin password
- Admin JWT stored separately in adminStore

---

## Platform Integrations

### CRM marketplace platform

#### OAuth Configuration
- **Client ID & Secret:** Stored in AppSettings (runtime configurable)
- **Scopes:** contacts.readonly, conversations/message.write, locations.readonly
- **Redirect URI:** `{APP_URL}/auth/callback`

#### CRM Adapter (`packages/server/src/adapters/crm-platform.adapter.ts`)
```typescript
class GHLAdapter extends BasePlatformAdapter {
  // Auth
  getOAuthUrl(state, redirectUri)
  exchangeCodeForTokens(code, redirectUri)
  refreshAccessToken(refreshToken)

  // Location (Sub-account)
  getLocationInfo(accessToken)

  // Contacts
  getContacts(accessToken, locationId, options)
  getContact(accessToken, locationId, contactId)
  createContact(accessToken, locationId, data)
  updateContact(accessToken, locationId, contactId, data)

  // Conversations
  getConversations(accessToken, locationId, options)
  getConversation(accessToken, conversationId)
  getMessages(accessToken, conversationId)
  sendMessage(accessToken, data)
}
```

### Signalmash

#### Service (`packages/server/src/services/signalmash.service.ts`)
```typescript
class SignalmashService {
  // DIDs
  listAvailableNumbers(options)   // Search available DIDs
  purchaseNumber(phoneNumber)     // Buy a DID
  releaseNumber(numberId)         // Release a DID
  configureWebhook(numberId, url) // Set webhook URL

  // Messaging
  sendSMS(from, to, body, options)
  sendMMS(from, to, body, mediaUrls)

  // 10DLC (via TCR)
  registerBrand(brandData)
  registerCampaign(campaignData)
  getCampaignStatus(campaignId)
}
```

---

## Key Features

### 1. Runtime CRM Credentials Configuration
- Admin can configure CRM Client ID/Secret at runtime
- No hardcoded credentials in env files
- Credentials stored encrypted in database
- Admin panel at `/admin/settings` for configuration

### 2. Multi-tenant Organization Support
- Each CRM location = one organization
- Users linked to organizations via CRM location
- Full data isolation between organizations

### 3. 10DLC Compliance
- Brand registration with TCR
- Campaign registration with use case
- Sample message verification
- Phone number assignment to approved campaigns

### 4. Phone Number (DID) Management
- Search available numbers by area code
- Purchase numbers through Signalmash
- Assign numbers to campaigns
- Release numbers when no longer needed
- Track capabilities (SMS/MMS/Voice)

### 5. Message Management
- Send SMS/MMS through platform
- Webhook-based delivery status updates
- Inbound message handling
- Message history and statistics

### 6. Admin Panel
- Initial setup wizard
- CRM credentials management
- Organization overview
- System statistics

---

## Environment Variables

### Server (.env)
```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/signalmash"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="7d"

# Encryption (for storing secrets)
ENCRYPTION_KEY="32-character-encryption-key-here"

# Server
PORT=3001
NODE_ENV=development

# URLs
APP_URL="http://localhost:5173"
API_URL="http://localhost:3001"

# Signalmash (can also be in AppSettings)
SIGNALMASH_API_URL="https://api.signalmash.com"
SIGNALMASH_API_KEY="your-signalmash-key"

# Note: CRM credentials are stored in AppSettings, not env
```

### Frontend (.env)
```bash
VITE_API_URL="http://localhost:3001/api"
```

### Production Environment
```bash
# Server
NODE_ENV=production
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
JWT_SECRET="production-secret"
ENCRYPTION_KEY="production-encryption-key"
APP_URL="https://yourdomain.com"
API_URL="https://yourdomain.com"

# Frontend
VITE_API_URL="https://yourdomain.com/api"
```

---

## Running the Project

### Prerequisites
- Node.js 18+
- PNPM 8+
- PostgreSQL 14+
- Redis 6+

### Development Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp packages/server/.env.example packages/server/.env
cp packages/web/.env.example packages/web/.env
# Edit .env files with your values

# 3. Set up database
cd packages/server
npx prisma db push
npx prisma generate

# 4. Start development servers
cd ../..
pnpm dev

# Server runs on http://localhost:3001
# Frontend runs on http://localhost:5173
```

### Initial Admin Setup

1. Navigate to `http://localhost:5173/admin/setup`
2. Create admin password
3. Navigate to `/admin/settings`
4. Configure CRM Client ID and Client Secret
5. Configure Signalmash API Key (optional)

### Build for Production

```bash
# Build all packages
pnpm build

# Or individual packages
pnpm -F @signalmash-connect/server build
pnpm -F @signalmash-connect/web build
```

---

## Deployment

### VPS Requirements
- Ubuntu 20.04+ or similar
- 2GB+ RAM
- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Nginx
- PM2

### Deployment Steps

See `deploy/DEPLOYMENT.md` for detailed instructions.

Quick overview:
```bash
# 1. Run setup script (first time only)
chmod +x deploy/setup-vps.sh
./deploy/setup-vps.sh

# 2. Deploy/update
chmod +x deploy/deploy.sh
./deploy/deploy.sh

# 3. Set up SSL
sudo certbot --nginx -d yourdomain.com
```

### PM2 Configuration
See `ecosystem.config.cjs` for process manager settings.

### Nginx Configuration
See `deploy/nginx.conf` for reverse proxy template.

---

## Important Implementation Details

### 1. Encryption Service
- Location: `packages/server/src/utils/encryption.ts`
- Uses AES-256-GCM encryption
- All secrets (tokens, API keys) stored encrypted
- ENCRYPTION_KEY must be 32 characters

### 2. Token Storage
- Access/refresh tokens encrypted before storing
- JWT tokens have 7-day expiry by default
- Refresh token rotation implemented

### 3. API Client (Frontend)
- Location: `packages/web/src/lib/api.ts`
- Automatic JWT token injection
- Automatic token refresh on 401
- Error handling with typed responses

### 4. Zustand Stores
- `auth.store.ts`: User authentication state
- `admin.store.ts`: Admin authentication state
- `theme.store.ts`: Theme preferences (dark/light)

### 5. UI Components
- Based on shadcn/ui patterns
- Located in `packages/web/src/components/ui/`
- Use Radix UI primitives
- Styled with Tailwind CSS

### 6. Form Validation
- Backend: Zod schemas in route files
- Frontend: React Hook Form with Zod resolver (where used)

### 7. Error Handling
- Custom AppError class for typed errors
- Centralized error handler middleware
- Consistent error response format

---

## Known Issues & TODOs

### Current Known Issues

1. **TypeScript Strict Mode Errors**
   - Some files have TS errors with `exactOptionalPropertyTypes`
   - These don't affect runtime but show in build output
   - Files: `admin.routes.ts`, `errorHandler.ts`, adapters

2. **Unused Imports Warnings**
   - Several pages have unused import warnings
   - Safe to ignore or clean up

### Pending Features

1. **Webhook Implementation**
   - Signalmash delivery status webhooks
   - CRM inbound message webhooks
   - Message status sync

2. **Full 10DLC Flow**
   - TCR API integration for brand submission
   - Campaign approval workflow
   - Number-to-campaign assignment validation

3. **Message Sending**
   - Complete send flow through Signalmash
   - Media attachment handling for MMS
   - Rate limiting and queuing

4. **Analytics Dashboard**
   - Message volume charts
   - Delivery rate statistics
   - Cost tracking

5. **User Management**
   - Invite team members
   - Role-based permissions
   - Activity logging

### Configuration Notes

- **CRM Marketplace:** App needs to be registered in CRM marketplace
- **CRM Redirect URI:** Must be real domain (no localhost in production)
- **Signalmash Account:** Need active account with API access
- **10DLC:** TCR integration requires Signalmash account setup

---

## Quick Reference

### Common Commands
```bash
# Development
pnpm dev                    # Start all dev servers
pnpm -F server dev          # Start only backend
pnpm -F web dev             # Start only frontend

# Database
cd packages/server
npx prisma studio          # Open Prisma Studio
npx prisma db push         # Push schema changes
npx prisma generate        # Regenerate client
npx prisma migrate dev     # Create migration

# Build
pnpm build                 # Build all packages
pnpm -F server build       # Build backend
pnpm -F web build          # Build frontend

# Production
pm2 start ecosystem.config.cjs
pm2 restart all
pm2 logs
pm2 monit
```

### Important URLs (Development)
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- API Health: http://localhost:3001/api/health
- Admin Setup: http://localhost:5173/admin/setup
- Admin Dashboard: http://localhost:5173/admin/dashboard

### Key Files for New Features
- New API route: `packages/server/src/routes/` + update `index.ts`
- New service: `packages/server/src/services/`
- New page: `packages/web/src/pages/` + update `App.tsx`
- New UI component: `packages/web/src/components/ui/`
- Database change: `packages/server/prisma/schema.prisma`

---

## Contact & Support

This project is built for Signalmash Connect marketplace integration.

For questions about:
- **CRM Integration:** Refer to CRM platform developer documentation
- **Signalmash API:** Refer to https://docs.signalmash.com/
- **10DLC/TCR:** Refer to https://www.campaignregistry.com/

---

*This document should be kept updated as the project evolves.*
