/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is a native-ish driver; keep it out of the bundler so it loads
  // normally inside the Node runtime used by the route handlers.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
