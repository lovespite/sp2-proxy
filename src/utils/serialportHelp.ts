import { SerialPort } from "serialport";

export async function listSerialPorts() {
  return await SerialPort.list();
}

export async function openSerialPort(portName: string, baudRate?: number) {
  if (portName.startsWith(".")) {
    const list = await listSerialPorts();
    const index = portName.length - 1;
    if (list.length <= index) {
      throw new Error(`No serial port available at index ${index}`);
    }
    portName = list[index].path;
  }

  if (!baudRate) baudRate = 1600000;

  return new Promise<SerialPort>((resolve, reject) => {
    const port = new SerialPort(
      {
        path: portName,
        baudRate: baudRate,
        autoOpen: true,
        stopBits: 1,
        parity: "none",
        dataBits: 8,
      },
      err => {
        if (err) reject(err);
        else resolve(port);
      }
    );
  });
}
