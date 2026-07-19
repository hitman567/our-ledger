import { defineConfig } from "vitest/config";

// Served at https://hitman567.github.io/our-ledger/, so assets must resolve
// under that subpath rather than the domain root.
export default defineConfig({
  base: "/our-ledger/",
  test: {
    environment: "node",
  },
});
