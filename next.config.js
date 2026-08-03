/** @type {import('next').NextConfig} */
// Kept intentionally minimal for v1. The API layer lives under app/api with
// business logic in /services so it could later be extracted into a standalone
// service without touching the frontend.
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // SC-024 Phase 2: archiver (and its dependency tree) ships an exports map
    // webpack 5 rejects with "Default condition should be last one". It is a
    // server-only, Node-only library used solely to stream the close-out ZIP,
    // so it is loaded at runtime rather than bundled. node_modules ships with
    // the deployment artifact, so it is present in production.
    serverComponentsExternalPackages: ['archiver'],
  },
  // Europe/London is the canonical timezone for all server-side date handling.
  // Times are stored in UTC and only formatted to British conventions at the edge.
  env: {
    NEXT_PUBLIC_APP_NAME: 'SiteComply',
  },
  async redirects() {
    return [
      // SC-021: configuration templates now live under Settings. BOTH historical
      // paths point straight at the final destination rather than chaining
      // through each other — a redirect chain costs an extra round trip and
      // breaks the moment an intermediate hop is removed.
      // Temporary (not permanent) so they can be withdrawn without fighting a
      // cached 308.
      {
        source: '/platform/dashboard/sites/config-templates',
        destination: '/platform/dashboard/settings/config-templates',
        permanent: false,
      },
      {
        source: '/platform/dashboard/compliance-calendar/config-templates',
        destination: '/platform/dashboard/settings/config-templates',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
