const { build } = require("esbuild");

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  minify: true,
  external: ["serialport"],
  tsconfig: "./tsconfig.json",
});
