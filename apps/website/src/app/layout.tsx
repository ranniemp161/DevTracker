import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'DevTrack', template: '%s · DevTrack' },
  description: 'Engineering project management with first-class GitHub integration.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set by the script below before React hydrates, so the server markup differs.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
