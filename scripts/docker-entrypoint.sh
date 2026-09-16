#!/bin/sh
# ======================================================
# WA-AKG Docker Entrypoint
# Runs DB migration and admin setup before starting app
# ======================================================

set -e

echo "==> Running Prisma DB push..."
npx prisma db push --skip-generate

echo "==> Creating SuperAdmin user (admin@example.com / admin123)..."
node scripts/setup-admin.js admin@example.com admin123 || true

echo "==> Starting WA-AKG..."
exec npm run start
