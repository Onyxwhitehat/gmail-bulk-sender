import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Bulk Email Sender',
  description: 'Send personalised bulk email through the Gmail API with live progress tracking.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

/**
 * Applies the stored theme before first paint.
 * Without this, the page renders light and then flips to dark on hydration.
 */
const themeScript = `(function(){try{var t=localStorage.getItem('bes-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce issued by middleware.ts so the inline script satisfies our strict CSP.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning is required, not cosmetic: browsers implement
          "nonce hiding", so `getAttribute('nonce')` returns "" on the client even
          though the value is present and enforced. React compares the attribute
          during hydration and reports a mismatch on every page load without this.
        */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
