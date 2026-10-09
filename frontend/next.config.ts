import type { NextConfig } from 'next'

// A fully static site (out/), served by nginx in Docker or by any static host.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
}

export default config
