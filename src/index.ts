import { SerialPort } from "serialport";
import test from "../test";
import { Pac, ProxyOptions, ProxyServer } from "./service/host";
import printUsage from "./utils/help";
import * as opt from "./utils/options";
import { listSerialPorts, openSerialPort } from "./utils/serialportHelp";
import ProxyEndPoint from "./service/proxy";
import { Messenger } from "./service/messenger";
import { version } from "./vc";

async function main() {
  console.log(`Serial Port Proxy v${version}`);
  opt.parse(process.argv.slice(2));

  const serialPortOpts: string[] = opt
    .getOption("serial-port", "s", ".")
    .split(",")
    .map((s) => s.trim());

  const baudRateOpts = opt.getOption("baud-rate", "b", "1600000").split(",");

  const baudRates = baudRateOpts
    .map((s) => parseInt(s.trim()))
    .filter((n) => !isNaN(n));

  if (baudRates.length === 0) baudRates.push(1600000);

  let serialPorts: SerialPort[];
  let opts: ProxyOptions;

  const cmd = opt.getCommand();
  if (!cmd) {
    printUsage();
  }

  switch (cmd) {
    case "list":
      listSerialPorts()
        .then((list) => {
          console.log(`Available serial ports:`);
          list.forEach((p, i) => {
            console.log(`[${i + 1}]  ${p.path}`);
            console.log(
              `      Manu.:${p.manufacturer} Vend.:${p.vendorId} Prod.:${p.productId}`
            );
            console.log("");
          });
        })
        .catch((err) => console.error(err));
      break;
    case "proxy":
      serialPorts = await openSerialPorts(serialPortOpts, baudRates);
      opts = { serialPorts };
      await new ProxyEndPoint(opts).proxy();
      break;
    case "host":
      serialPorts = await openSerialPorts(serialPortOpts, baudRates);
      opts = {
        serialPorts,
        port: parseInt(opt.getOption("port", "p", "13808")),
        listen: opt.getOption("listen", "l", "0.0.0.0"),
      };
      var pacFile = process.env.WGUIFRAME2_PAC;
      let pac: Pac = null;
      if (pacFile) {
        pac = await Pac.loadFromPacFile(pacFile);
        console.log(`PAC file loaded from ${pacFile}`);
      }
      new ProxyServer(opts, pac).listen();
      break;
    case "test":
      await test(opt.getArgs());
      break;
    case "msg":
      serialPorts = await openSerialPorts([serialPortOpts[0]], baudRates);
      const msg = new Messenger(serialPorts[0]);
      msg.start({
        port: parseInt(opt.getOption("port", "p", "13809")),
        listen: opt.getOption("listen", "l", "127.0.0.1"),
      });
      break;
    default:
      printUsage();
  }
}

main();

async function openSerialPorts(
  serialPortOpts: string[],
  baudRates: number[]
): Promise<SerialPort[]> {
  if (baudRates.length !== serialPortOpts.length) {
    const defaultBaudRate = baudRates[0];
    baudRates = Array(serialPortOpts.length).fill(defaultBaudRate);
  }

  return await Promise.all(
    serialPortOpts.map(
      async (name, i) => await openSerialPort(name, baudRates[i])
    )
  );
}
