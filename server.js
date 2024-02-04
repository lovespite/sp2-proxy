const { spawn } = require("child_process");

console.log(
  "For test purposes, we will spawn two processes and wait for them to exit."
);

async function main() {
  const p1 = spawn("yarn msg", {
    shell: true,
  });

  p1.on("error", (e) => console.log("P1 > Error:", e));
  p1.stdout.on("data", (d) => console.log("P1 > ", d.toString()));

  const p2 = spawn("yarn msg2", {
    shell: true,
  });

  p2.on("error", (e) => console.log("P2 > Error:", e));
  p2.stdout.on("data", (d) => console.log("P2 > ", d.toString()));

  await new Promise((resolve, reject) => {
    p1.once("exit", resolve);
    p2.once("exit", resolve);
  });
}

main();
