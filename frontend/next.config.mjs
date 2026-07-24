/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/preview/:path*",
        destination: "http://localhost:8000/api/preview/:path*",
      },
    ];
  },
};

export default nextConfig;
