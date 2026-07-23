/** @type {import('next').NextConfig} */
const nextConfig = {
  // The x402 middleware + Anthropic SDK run server-side only.
  serverExternalPackages: ["@injectivelabs/x402", "@anthropic-ai/sdk"],
};
export default nextConfig;
