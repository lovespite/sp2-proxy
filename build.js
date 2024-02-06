const { build } = require("esbuild");
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");

const vcFile = path.resolve(__dirname, "src/vc.js");
const vcContent = readFileSync(vcFile, "utf-8");
const [_, major, minor, patch] = vcContent.match(
  /version = "(\d+)\.(\d+)\.(\d+)"/
);

const patchVer = (parseInt(patch) || 0) + 1;

const nextVcContent = vcContent.replace(
  `version = "${major}.${minor}.${patch}"`,
  `version = "${major}.${minor}.${patchVer}"`
);

console.log(
  `Bumping version from ${major}.${minor}.${patch} to ${major}.${minor}.${patchVer}`
);

writeFileSync(vcFile, nextVcContent);

build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  minify: false,
  external: ["serialport"],
  tsconfig: "./tsconfig.json",
});
