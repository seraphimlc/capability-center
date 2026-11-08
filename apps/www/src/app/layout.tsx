import type { Metadata } from 'next';
import './globals.css';
import { Shell } from '../components/shell';

export const metadata: Metadata = {
  title: '能力中心',
  description: '发现、调用并计量你的业务能力',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,680&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
