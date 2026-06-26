import type { Metadata, Viewport } from 'next';
import { appConfig } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(appConfig.baseUrl),
  title: 'SiteComply — Digital site inductions for UK construction',
  description:
    'Complete your site induction, health & safety checks and check-in ' +
    'digitally in under two minutes. Built for UK construction sites.',
  applicationName: 'SiteComply',
};

export const viewport: Viewport = {
  // Mobile-first: lock to device width, allow zoom for accessibility.
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e40af',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // British English locale set at the document root for correct date/number
  // formatting and spell-checking behaviour throughout the app.
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
