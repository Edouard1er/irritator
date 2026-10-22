import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  // Shared contracts use NodeNext .js specifiers and ship TypeScript sources.
  experimental: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${process.env.IRRITATOR_API_URL ?? 'http://127.0.0.1:3001'}/api/v1/:path*` }];
  },
};
export default config;
