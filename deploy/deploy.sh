#!/bin/bash
# ===========================================
# Deployment Script for Signalmash Connect
# ===========================================
# Run this script to deploy updates
#
# Usage: bash deploy.sh

set -e

APP_DIR="/var/www/signalmash"
cd ${APP_DIR}

echo "=== Deploying Signalmash Connect ==="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Step 1: Pull latest changes${NC}"
git pull origin main

echo -e "${YELLOW}Step 2: Install dependencies${NC}"
pnpm install

echo -e "${YELLOW}Step 3: Build packages${NC}"
pnpm build

echo -e "${YELLOW}Step 4: Run database migrations${NC}"
cd packages/server
pnpm db:push
cd ../..

echo -e "${YELLOW}Step 5: Restart server${NC}"
pm2 restart signalmash-server

echo -e "${YELLOW}Step 6: Verify billing wallet API contract${NC}"
bash deploy/smoke-billing-wallet.sh

echo -e "${GREEN}=== Deployment complete! ===${NC}"
pm2 status
