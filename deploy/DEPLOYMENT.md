# Signalmash Connect - VPS Deployment Guide

This guide covers deploying Signalmash Connect to an Ubuntu VPS.

## Prerequisites

- Ubuntu 20.04+ VPS with root access
- Domain name with DNS access
- SSH access to the server

## Domain Setup

You'll need two subdomains pointing to your VPS IP:
- `api.yourdomain.com` → API server
- `app.yourdomain.com` → Frontend app

Add these A records in your DNS:
```
api.yourdomain.com  →  YOUR_VPS_IP
app.yourdomain.com  →  YOUR_VPS_IP
```

## Step 1: Initial Server Setup

SSH into your VPS and run the setup script:

```bash
# Upload or copy the setup script
scp deploy/setup-vps.sh root@YOUR_VPS_IP:/root/

# SSH in and run it
ssh root@YOUR_VPS_IP
bash setup-vps.sh
```

This installs: Node.js 20, pnpm, PM2, PostgreSQL, Redis, Nginx, Certbot

## Step 2: Clone Repository

```bash
cd /var/www
git clone YOUR_REPO_URL signalmash
cd signalmash
```

## Step 3: Setup PostgreSQL Database

```bash
# Access PostgreSQL
sudo -u postgres psql

# Create user and database
CREATE USER signalmash WITH PASSWORD 'your_secure_password_here';
CREATE DATABASE signalmash OWNER signalmash;
GRANT ALL PRIVILEGES ON DATABASE signalmash TO signalmash;
\q
```

## Step 4: Configure Environment

**Server Configuration:**
```bash
cd /var/www/signalmash/packages/server

# Copy the production template
cp .env.production.example .env

# Edit with your values
nano .env
```

**Required changes in server .env:**
```env
NODE_ENV=production
API_URL=https://api.yourdomain.com
WEB_URL=https://app.yourdomain.com

DATABASE_URL=postgresql://signalmash:your_secure_password_here@localhost:5432/signalmash?schema=public

# Generate secure secrets (run each command and paste result):
# openssl rand -hex 32
JWT_SECRET=<paste_generated_value>
JWT_REFRESH_SECRET=<paste_generated_value>
SESSION_SECRET=<paste_generated_value>
ENCRYPTION_KEY=<32_character_string>
```

**Web Frontend Configuration:**
```bash
cd /var/www/signalmash/packages/web

# Create production env
cp .env.production.example .env.production

# Edit with your API URL
nano .env.production
```

Set `VITE_API_URL=https://api.yourdomain.com/api/v1`

## Step 5: Install & Build

```bash
cd /var/www/signalmash

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run database migrations
cd packages/server
pnpm db:push
cd ../..
```

## Step 6: Configure Nginx

```bash
# Edit nginx config with your domain
nano deploy/nginx.conf
# Replace YOURDOMAIN.COM with your actual domain

# Copy to nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/signalmash

# Enable the site
sudo ln -s /etc/nginx/sites-available/signalmash /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Step 7: Get SSL Certificate

```bash
sudo certbot --nginx -d api.yourdomain.com -d app.yourdomain.com
```

Follow the prompts to complete SSL setup.

## Step 8: Start the Application

```bash
cd /var/www/signalmash

# Create logs directory
mkdir -p packages/server/logs

# Start with PM2
pm2 start ecosystem.config.cjs --env production

# Save PM2 process list
pm2 save

# Check status
pm2 status
pm2 logs signalmash-server
```

## Step 9: Configure CRM OAuth

Now that you have a real domain:

1. Go to your CRM Marketplace App settings
2. Add Redirect URI: `https://api.yourdomain.com/api/platforms/:platform/callback`
3. Save the changes

## Verification

Test your deployment:

```bash
# Test API
curl https://api.yourdomain.com/api/v1/health

# Visit frontend
# Open https://app.yourdomain.com in browser
```

---

## Common Commands

```bash
# View logs
pm2 logs signalmash-server

# Restart server
pm2 restart signalmash-server

# Stop server
pm2 stop signalmash-server

# Deploy updates
cd /var/www/signalmash
bash deploy/deploy.sh
```

## Troubleshooting

### Server won't start
```bash
# Check logs
pm2 logs signalmash-server --lines 50

# Check if port is in use
sudo lsof -i :3001
```

### Database connection failed
```bash
# Test PostgreSQL connection
psql -U signalmash -h localhost -d signalmash
```

### Nginx errors
```bash
# Test config
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
```

### SSL issues
```bash
# Renew certificates
sudo certbot renew --dry-run
```
