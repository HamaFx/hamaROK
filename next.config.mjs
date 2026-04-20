import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  async redirects() {
    return [
      {
        source: '/activity',
        destination: '/rankings?scope=weekly',
        permanent: false,
      },
      {
        source: '/compare',
        destination: '/assistant',
        permanent: false,
      },
      {
        source: '/insights',
        destination: '/assistant',
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias.canvas = false;
    }
    return config;
  },
};

export default nextConfig;
