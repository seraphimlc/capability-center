/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    const target = process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      { source: '/v1/:path*', destination: `${target}/v1/:path*` },
      { source: '/mcp', destination: `${target}/mcp` },
      { source: '/healthz', destination: `${target}/healthz` },
    ];
  },
};

module.exports = nextConfig;
