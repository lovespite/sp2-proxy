const { exec } = require("child_process");

async function main() {
  const p1 = exec("yarn msg", e => {
    if (e) {
      console.log(e);
    }
    console.log("messenger host 1 start");
  });

  p1.stdout.on("data", d => console.log("P1", d));

  const p2 = exec("yarn msg2", e => {
    if (e) {
      console.log(e);
    }
    console.log("messenger host 2 start");
  });

  p2.stdout.on("data", d => console.log("P2", d));

  await new Promise((resolve, reject) => {
    p1.once("exit", resolve);
    p2.once("exit", resolve);
  });
}

main();
