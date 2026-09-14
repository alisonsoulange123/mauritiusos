/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /*
   * Traces the server build down to the files it actually imports and emits a
   * self-contained bundle with its own minimal `node_modules`.
   *
   * Without it a runtime image has to carry the whole pnpm workspace to serve a
   * handful of routes. With it the runner stage copies one directory and never
   * installs anything — which also means the production image contains no
   * package manager, no lockfile and no build toolchain to be exploited.
   */
  output: 'standalone',
  // Workspace packages ship TypeScript source, not build output — one less
  // build step, and jumping to a definition lands in the real file.
  transpilePackages: ['@reef-technologies/ui', '@reef-technologies/contracts', '@reef-technologies/config'],
  experimental: {
    // Keeps `features/*/index.ts` metadata imports from dragging whole feature
    // trees into the shared bundle.
    optimizePackageImports: ['@reef-technologies/ui'],
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
