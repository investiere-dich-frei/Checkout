import type { NextConfig } from "next";

const config: NextConfig = {
  // Die Workspace-Pakete liegen als TypeScript-Quellen vor.
  transpilePackages: ["@idf/core", "@idf/db"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
};

export default config;
