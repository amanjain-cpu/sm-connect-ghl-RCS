# CLAUDE.md - AI Assistant Context

> **Read this file first when working on this project.**
> For complete documentation, see [PROJECT_REFERENCE.md](./PROJECT_REFERENCE.md)

> **QA task creation / handoff:** read `docs/runbooks/qa-agent-playbook.md` and
> `docs/runbooks/qa-task-workflow.md` before creating, reviewing, or announcing
> manual QA. GitHub issues are the source of truth; Slack is only the notification
> layer.

## Project Summary

**Signalmash Connect** is a CRM (CRM platform) marketplace app that integrates Signalmash SMS/MMS APIs with CRM sub-accounts for A2P 10DLC compliant messaging.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development
pnpm dev

# Frontend: http://localhost:5173
# Backend: http://localhost:3001
```

## Project Structure

```
packages/
├── server/          # Express.js API (TypeScript)
│   ├── src/
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Business logic
│   │   ├── adapters/    # External API adapters (CRM, etc.)
│   │   └── middleware/  # Auth, validation, errors
│   └── prisma/          # Database schema
│
├── web/             # React frontend (TypeScript + Vite)
│   └── src/
│       ├── pages/       # Route pages
│       ├── components/  # UI components
│       ├── stores/      # Zustand state
│       └── lib/         # API client, utils
│
└── shared/          # Shared types
```

## Tech Stack

- **Backend:** Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Zustand
- **Auth:** CRM OAuth SSO, JWT tokens
- **External APIs:** CRM platform, Signalmash, TCR (10DLC)

## Key Concepts

### Authentication
- Users authenticate via CRM SSO OAuth flow
- Each CRM location = one organization
- JWT tokens for API auth (7 day expiry)
- Admin panel has separate auth

### Core Entities
1. **Organization** - Represents a CRM location/sub-account
2. **Brand** - 10DLC brand registration for business identity
3. **Campaign** - 10DLC campaign for message use case
4. **PhoneNumber** - DID purchased from Signalmash
5. **Message** - SMS/MMS sent/received

### Data Flow
```
CRM User → OAuth → Organization created → Register Brand →
Create Campaign → Buy Phone Numbers → Send Messages
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/server/prisma/schema.prisma` | Database schema |
| `packages/server/src/routes/index.ts` | API route aggregator |
| `packages/web/src/App.tsx` | Frontend routes |
| `packages/web/src/lib/api.ts` | API client |
| `ecosystem.config.cjs` | PM2 production config |
| `deploy/` | Deployment scripts |

## Common Tasks

### Add new API endpoint
1. Create/edit route file in `packages/server/src/routes/`
2. Create/edit service in `packages/server/src/services/`
3. Register route in `packages/server/src/routes/index.ts`
4. Add API method in `packages/web/src/lib/api.ts`

### Add new page
1. Create page in `packages/web/src/pages/`
2. Add route in `packages/web/src/App.tsx`
3. Update sidebar in `packages/web/src/components/layout/sidebar.tsx`

### Database changes
```bash
cd packages/server
# Edit prisma/schema.prisma
npx prisma db push      # Apply changes
npx prisma generate     # Regenerate client
```

## Environment Variables

### Server (`packages/server/.env`)
```
DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
ENCRYPTION_KEY=... (32 chars)
APP_URL=http://localhost:5173
API_URL=http://localhost:3001
```

### Frontend (`packages/web/.env`)
```
VITE_API_URL=http://localhost:3001/api
```

**Note:** CRM Client ID/Secret are configured at runtime via admin panel, not env files.

## Admin Panel

- **Setup:** `/admin/setup` - First-time admin password creation
- **Settings:** `/admin/settings` - Configure CRM credentials
- **Dashboard:** `/admin/dashboard` - System overview

## API Patterns

### Response format
```typescript
// Success
{ success: true, data: {...} }

// Error
{ success: false, error: { code: string, message: string } }
```

### Authentication
- User routes use `authenticate` middleware
- Admin routes use `authenticateAdmin` middleware
- JWT in `Authorization: Bearer <token>` header

## Current State

### Implemented
- CRM OAuth SSO authentication
- Organization management
- Brand registration UI
- Campaign management
- Phone number search/purchase/management
- Admin panel with settings
- Deployment configuration

### Pending
- Full TCR API integration for 10DLC submission
- Signalmash webhook handling
- Message sending through Signalmash
- Detailed analytics dashboard

## Deployment

See `deploy/DEPLOYMENT.md` for VPS deployment instructions.

Quick deploy:
```bash
./deploy/setup-vps.sh  # First time
./deploy/deploy.sh     # Updates
```

## Gotchas

1. **CRM OAuth:** Redirect URI must be real domain (not localhost) in production
2. **Encryption:** All secrets stored encrypted, need ENCRYPTION_KEY
3. **Tokens:** CRM tokens stored encrypted in PlatformConnection
4. **UI Components:** Custom shadcn-style components in `components/ui/`

## External Documentation

- CRM API: CRM platform developer documentation
- Signalmash: https://docs.signalmash.com/
- 10DLC/TCR: https://www.campaignregistry.com/

---

**For complete details, architecture diagrams, and full API reference, see [PROJECT_REFERENCE.md](./PROJECT_REFERENCE.md)**
