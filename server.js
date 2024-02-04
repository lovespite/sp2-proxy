const { spawn } = require("child_process");
require("dotenv").config();

const { DEV_BAUDRATE = 1_600_000, DEV_PORT1, DEV_PORT2 } = process.env;

console.log("DEV_PORT1", DEV_PORT1);
console.log("DEV_PORT2", DEV_PORT2);
console.log("DEV_BAUDRATE", DEV_BAUDRATE);

console.log(
  "For test purposes, we will spawn two processes and wait for them to exit."
);

async function main() {
  const p1 = spawn(
    "node",
    ["./dist/index.js", "msg", `-s=${DEV_PORT1}`, `-b=${DEV_BAUDRATE}`],
    {
      shell: true,
    }
  );

  p1.stderr.on("data", (e) => console.log("P1 > Error:", e.toString()));
  p1.stdout.on("data", (d) => console.log("P1 > ", d.toString()));

  const p2 = spawn(
    "node",
    [
      "./dist/index.js",
      "msg",
      `-s=${DEV_PORT2}`,
      `-b=${DEV_BAUDRATE}`,
      "-l=127.0.0.1",
      "-p=13810",
    ],
    {
      shell: true,
    }
  );

  p2.stderr.on("data", (e) => console.log("P2 > Error:", e.toString()));
  p2.stdout.on("data", (d) => console.log("P2 > ", d.toString()));

  await new Promise((resolve, reject) => {
    p1.once("exit", resolve);
    p2.once("exit", resolve);
  });
}

main();
