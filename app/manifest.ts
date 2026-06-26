import type { MetadataRoute } from 'next';

/**
 * Web app manifest so workers can "Add to Home Screen" and get a fast,
 * app-like launch on site. Next serves this at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SiteComply',
    short_name: 'SiteComply',
    description:
      'Digital site inductions and compliance check-in for UK construction.',
    start_url: '/check-in',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#1e40af',
    lang: 'en-GB',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
