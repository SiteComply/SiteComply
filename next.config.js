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
  async redirects() {
    return [
      {
        // SC-021 Phase 2 UX move: configuration templates moved from Sites to
        // Compliance. Kept as a redirect rather than a hard break because the
        // old path was shared for testing and may be bookmarked. Temporary
        // (not permanent) so it can be withdrawn without fighting a cached 308.
        source: '/platform/dashboard/sites/config-templates',
        destination: '/platform/dashboard/compliance-calendar/config-templates',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
