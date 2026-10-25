import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones and laptops on the same Wi-Fi open the dev server by its network address.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
