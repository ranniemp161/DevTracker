import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
