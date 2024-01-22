import { ChannelManager } from "./src/model/ChannelManager.js";
import { PhysicalPortHost } from "./src/model/PhysicalPortHost.js";
import { openSerialPort } from "./src/utils/serialportHelp.js";
import * as fs from "fs";

export default async function test(args: [string, string][]) {
  const test_cmd = args[0][0];
  console.log(args);
  switch (test_cmd) {
    case "channel_s":
      // test channel_s COM1
      await channel_test_server(args[1][0]);
      break;
    case "channel_c":
      // test channel_c COM2
      await channel_test_client(args[1][0], args[2][0]);
      break;
    default:
      break;
  }
}

async function channel_test_server(portName: string) {
  const physicalPort = await openSerialPort(portName, 1_600_000);
  const host = new PhysicalPortHost(physicalPort);
  host.start();

  const chnMan = new ChannelManager(host, "svr");
  const chn1 = chnMan.createChannel();

  const fileStream = fs.createWriteStream("test.txt");

  // await chn1.copyTo(fileStream);
  chn1.pipe(fileStream);

  await new Promise(res => chn1.once("end", res));

  console.log("File finished.");

  fileStream.close();
  await chnMan.destroy();
}

async function channel_test_client(portName: string, file: string) {
  const physicalPort = await openSerialPort(portName, 1_600_000);
  const host = new PhysicalPortHost(physicalPort);

  host.start();

  const chnMan = new ChannelManager(host, "client");

  const chn1 = chnMan.createChannel();

  const fileStream = fs.createReadStream(file);

  console.log("Streaming...");
  fileStream.pipe(chn1);

  await new Promise(res => {
    chn1.on("finish", res);
  });

  chn1.destroy();
  console.log("Done.");
  fileStream.close();

  await chnMan.destroy();
}
