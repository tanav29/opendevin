import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@tabler/icons-react", "lucide-react", "@hugeicons/react"],
  },
};

export default nextConfig;
