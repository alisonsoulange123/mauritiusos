/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, not build output — one less
  // build step, and jumping to a definition lands in the real file.
  transpilePackages: ['@anomalia/ui', '@anomalia/contracts', '@anomalia/config'],
  experimental: {
    // Keeps `features/*/index.ts` metadata imports from dragging whole feature
    // trees into the shared bundle.
    optimizePackageImports: ['@anomalia/ui'],
  },
  async rewrites() {
    // Same-origin API in development, so cookies and CORS behave in dev the
    // way they will behind a shared domain in production.
    return [
      {
        source: '/api/proxy/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
