import type { Metadata } from 'next';
import './globals.css';
import { Shell } from '../components/shell';

export const metadata: Metadata = { title: '能力中心 · 管理' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
