import { SerialPort } from "serialport";
import test from "../test";
import { ProxyOptions, ProxyServer } from "./service/host";
import printUsage from "./utils/help";
import * as opt from "./utils/options";
import { listSerialPorts, openSerialPort } from "./utils/serialportHelp";
import ProxyEndPoint from "./service/proxy";

async function main() {
  opt.parse(process.argv.slice(2));

  const serialPortName: string[] = opt
    .getOption("serial-port", "s", ".")
    .split(",")
    .map(s => s.trim());

  const baudRate: number = parseInt(opt.getOption("baud-rate", "b", "1600000"));

  let serialPorts: SerialPort[];
  let opts: ProxyOptions;

  const cmd = opt.getCommand();
  if (!cmd) {
    printUsage();
  }

  switch (cmd) {
    case "list":
      listSerialPorts()
        .then(list => {
          console.log(`Available serial ports:`);
          list.forEach((p, i) => {
            console.log(`[${i + 1}]  ${p.path}`);
            console.log(`      Manu.:${p.manufacturer} Vend.:${p.vendorId} Prod.:${p.productId}`);
            console.log("");
          });
        })
        .catch(err => console.error(err));
      break;
    case "proxy":
      serialPorts = await Promise.all(serialPortName.map(async name => await openSerialPort(name, baudRate)));
      opts = { serialPorts };
      await new ProxyEndPoint(opts).proxy();
      break;
    case "host":
      serialPorts = await Promise.all(serialPortName.map(async name => await openSerialPort(name, baudRate)));
      opts = {
        serialPorts,
        port: parseInt(opt.getOption("port", "p", "13808")),
        listen: opt.getOption("listen", "l", "0.0.0.0"),
      };
      new ProxyServer(opts).listen();
      break;
    case "test":
      await test(opt.getArgs());
      break;
    default:
      printUsage();
  }
}

main();
