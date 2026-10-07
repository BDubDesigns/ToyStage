import { defineConfig } from "vite";

export default defineConfig({
  // The custom domain serves from the origin root, not a /ToyStage/ subpath.
  base: "/",
});
