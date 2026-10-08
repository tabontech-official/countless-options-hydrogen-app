import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  // Vercel splits the server build into per-function bundles; elsewhere (npm start, Docker)
  // the build must stay at build/server/index.js.
  presets: process.env.VERCEL ? [vercelPreset()] : [],
};
