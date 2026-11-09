import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    if (process.env.KITSUNEGATE_API_SOCKET) return [];
    return [
      {
        source: '/api/:path*',
        destination: `http://127.0.0.1:${Number(process.env.KITSUNEGATE_API_PORT ?? process.env.RELAYDECK_API_PORT ?? 8787)}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
