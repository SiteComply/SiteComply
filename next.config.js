/** @type {import('next').NextConfig} */
// Kept intentionally minimal for v1. The API layer lives under app/api with
// business logic in /services so it could later be extracted into a standalone
// service without touching the frontend.
const nextConfig = {
  reactStrictMode: true,
  // Europe/London is the canonical timezone for all server-side date handling.
  // Times are stored in UTC and only formatted to British conventions at the edge.
  env: {
    NEXT_PUBLIC_APP_NAME: 'SiteComply',
  },
};

module.exports = nextConfig;
