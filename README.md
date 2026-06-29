# SignalMash Connect

A multi-platform SMS messaging marketplace application that integrates with Signalmash APIs. Currently supports CRM marketplace platform with architecture designed for future expansion to Shopify, Salesforce, HubSpot, and Zoho.

## Features

- **10DLC Brand Registration**: Register and verify business brands for compliant SMS messaging
- **Campaign Management**: Create and manage SMS campaigns with compliance settings
- **Multi-Platform Integration**: Connect with CRM (more platforms coming soon)
- **Professional UI**: macOS-inspired glassmorphism design
- **Real-time Message Tracking**: Monitor message delivery and status
- **API Key Management**: Secure API access for programmatic integration

## Tech Stack

### Backend
- **Node.js** with Express.js
- **TypeScript** for type safety
- **Prisma** ORM with PostgreSQL
- **Redis** for caching and session management
- **Zod** for validation
- **Pino** for logging

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development
- **TailwindCSS** with custom glassmorphism theme
- **Framer Motion** for animations
- **React Hook Form** with Zod validation
- **Zustand** for state management

### Infrastructure
- **Docker** & Docker Compose
- **Nginx** for web server
- **Traefik** for reverse proxy (production)

## Project Structure

```
signalmash-connect/
├── packages/
│   ├── shared/           # Shared types, constants, utilities
│   ├── server/           # Express.js API server
│   │   ├── prisma/       # Database schema and migrations
│   │   ├── src/
│   │   │   ├── adapters/ # Platform adapters (CRM, etc.)
│   │   │   ├── config/   # Configuration
│   │   │   ├── middleware/
│   │   │   ├── routes/   # API routes
│   │   │   ├── services/ # Business logic
│   │   │   └── utils/    # Utilities
│   │   └── Dockerfile
│   └── web/              # React frontend
│       ├── src/
│       │   ├── components/
│       │   ├── lib/
│       │   ├── pages/
│       │   ├── stores/
│       │   └── styles/
│       ├── Dockerfile
│       └── nginx.conf
├── docker-compose.yml    # Development
├── docker-compose.prod.yml # Production
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20+
- Yarn
- Docker & Docker Compose
- PostgreSQL 15+ (or use Docker)
- Redis 7+ (or use Docker)

### Environment Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/signalmash-connect.git
cd signalmash-connect
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Configure environment variables:
```env
# Database
DATABASE_URL=postgresql://signalmash:password@localhost:5432/signalmash

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secrets (generate secure random strings)
JWT_SECRET=your-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars

# Encryption Key (32 bytes hex)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef

# Signalmash API
SIGNALMASH_API_KEY=your-signalmash-api-key
SIGNALMASH_API_URL=https://api.signalmash.com

# CRM App Credentials
CRM_APP_CLIENT_ID=your-crm-client-id
CRM_APP_CLIENT_SECRET=your-crm-client-secret
GHL_APP_REDIRECT_URI=http://localhost:3000/oauth/callback

# App URL
APP_URL=http://localhost:3000
```

### Development

#### Using Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

#### Manual Setup

1. Install dependencies:
```bash
yarn install
```

2. Set up database:
```bash
cd packages/server
npx prisma migrate dev
```

3. Start development servers:
```bash
# Terminal 1 - Server
cd packages/server
yarn dev

# Terminal 2 - Web
cd packages/web
yarn dev
```

4. Access the application:
- Frontend: http://localhost:5173
- API: http://localhost:3001

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user and organization
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Brands
- `GET /api/brands` - List brands
- `POST /api/brands` - Create brand
- `GET /api/brands/:id` - Get brand details
- `PUT /api/brands/:id` - Update brand
- `POST /api/brands/:id/submit` - Submit for verification
- `DELETE /api/brands/:id` - Delete brand

### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns/:id` - Get campaign details
- `PUT /api/campaigns/:id` - Update campaign
- `POST /api/campaigns/:id/submit` - Submit for approval
- `POST /api/campaigns/:id/pause` - Pause campaign
- `POST /api/campaigns/:id/resume` - Resume campaign

### Messages
- `GET /api/messages` - List messages
- `POST /api/messages` - Send message
- `GET /api/messages/stats` - Get message statistics

### Platforms
- `GET /api/platforms/connections` - List connections
- `GET /api/platforms/:platform/oauth` - Get OAuth URL
- `DELETE /api/platforms/connections/:id` - Disconnect

### Webhooks
- `POST /webhooks/signalmash` - Signalmash status callbacks
- `POST /webhook` - CRM webhook events
- `GET /oauth/callback` - OAuth callback handler

## CRM Integration

### Setting Up as CRM Marketplace App

1. Create a new app in CRM Developer Portal
2. Configure OAuth 2.0 scopes:
   - `conversations.readonly`
   - `conversations.write`
   - `conversations/message.readonly`
   - `conversations/message.write`
   - `contacts.readonly`
   - `locations.readonly`

3. Set redirect URI to your callback URL
4. Add your app's custom pages for brand/campaign registration

### Custom Pages Setup

Add these pages to your CRM app:
- `/register` - Brand registration form
- `/campaigns` - Campaign management
- `/settings` - App settings

## Production Deployment

### Using Docker Compose

1. Configure production environment variables in `.env`

2. Build and push images:
```bash
docker build -t your-registry/signalmash-server:latest -f packages/server/Dockerfile .
docker build -t your-registry/signalmash-web:latest -f packages/web/Dockerfile .
docker push your-registry/signalmash-server:latest
docker push your-registry/signalmash-web:latest
```

3. Deploy:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables for Production

Ensure all secrets are properly set:
- Use strong, unique JWT secrets
- Use proper database credentials
- Set correct domain in APP_URL
- Configure proper Redis password

## Security Considerations

- All OAuth tokens are encrypted at rest
- JWT tokens have short expiration (15 minutes)
- Refresh tokens are rotated on use
- Rate limiting on sensitive endpoints
- Input validation on all endpoints
- CSP headers configured for CRM iframe embedding

## License

MIT
