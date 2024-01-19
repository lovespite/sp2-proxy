import { ReadlineParser, SerialPort } from "serialport";
import { DataPack } from "./DataPack";
import delay from "../utils/delay";

type onPackReceivedEvent = (pack: DataPack) => void;

export class PhysicalPortHost {
  private readonly _queueIncoming: DataPack[];
  private readonly _queueOutgoing: DataPack[];

  private readonly _physical: SerialPort;
  private readonly _parser: ReadlineParser;
  private readonly packEventList: Set<onPackReceivedEvent> = new Set();

  private _isDestroyed: boolean = false;
  private _isRunning: boolean = false;
  private _isFinished: boolean = false;

  constructor(port: SerialPort) {
    this._physical = port;
    this._physical.on("error", console.error);
    this._physical.on("close", () => console.log("CLOSED"));

    this._queueIncoming = [];
    this._queueOutgoing = [];

    this._parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
    this._parser.on("data", this.onReceivedInternal.bind(this));

    console.log("Port opened.");
  }

  public async waitForFinish() {
    while (!this._isFinished) {
      await delay(100);
    }
  }

  public enqueueOut(packs: DataPack[]) {
    if (this._isDestroyed || !this._isRunning) {
      throw new Error("Port is not running.");
    }

    this._queueOutgoing.push(...packs);
  }

  public publishCtlMessage(msg: string) {
    if (this._isDestroyed || !this._isRunning) {
      throw new Error("Port is not running.");
    }

    this._queueOutgoing.unshift({
      cid: 0,
      id: 0,
      data: Buffer.from(msg, "utf8").toString("base64"),
    }); // the highest priority
  }

  public onPackReceived(event: onPackReceivedEvent) {
    this.packEventList.add(event);
  }

  public offPackReceived(event: onPackReceivedEvent) {
    this.packEventList.delete(event);
  }

  public async start() {
    if (this._isDestroyed) {
      throw new Error("Port is destroyed.");
    }

    if (this._isRunning) {
      throw new Error("Port is already running.");
    }

    this._isRunning = true;
    await Promise.all([this.startSendingDequeueTask(), this.startReceivingDequeueTask()]);
  }

  private async stop() {
    this._isRunning = false;
    await this.waitForFinish();
  }

  public async destroy() {
    this._isDestroyed = true;
    await this.stop();
    if (this._physical.isOpen) this._physical.close();
    this._parser.destroy();
    this.packEventList.clear();
    this._queueIncoming.length = 0;
    this._queueOutgoing.length = 0;
  }

  private onReceivedInternal(data: string) {
    try {
      const pack: DataPack = JSON.parse(data);
      if (pack.cid === undefined) return;

      this._queueIncoming.push(pack);
    } catch (e) {
      console.log("M_ERROR", e.message, data);
    }
  }

  private async startSendingDequeueTask() {
    try {
      while (true) {
        if (!this._isRunning && this._queueOutgoing.length === 0) break; // no more data to send
        const pack = await this.blockDequeueOut();
        if (!pack) continue;

        if (!this._physical) break;

        const json = JSON.stringify(pack);

        this._physical.write(json + "\r\n");
        await new Promise(res => this._physical.drain(res));

        // if (pack.data) {
        //   console.log("SENT", pack.cid, pack.id, json.length);
        // } else {
        //   console.log("SENT", pack.cid, pack.id, "[END]");
        // }
      }
    } catch (e) {
      console.log(e.message);
    }
    this._isFinished = true;
    console.log("SENDING STOPPED");
  }

  private emitPackReceived(pack: DataPack) {
    return new Promise<void>(resolve => {
      this.packEventList.forEach((event): void => {
        try {
          event(pack);
        } catch (e) {
          console.error(e);
        }
      });
      resolve();
    });
  }

  private async startReceivingDequeueTask() {
    try {
      while (this._isRunning) {
        const pack = await this.blockDequeueIn();

        this.emitPackReceived(pack);
      }
    } catch (e) {
      console.log(e.message);
    }
    console.log("RECEIVING STOPPED");
  }

  private async blockDequeueIn(): Promise<DataPack> {
    while (this._queueIncoming.length === 0) {
      await delay(100);
      if (!this._isRunning) throw new Error("Port stopped.");
    }
    return this._queueIncoming.shift();
  }

  private async blockDequeueOut(): Promise<DataPack | undefined> {
    while (this._queueOutgoing.length === 0) {
      await delay(100);
      if (!this._isRunning) return;
    }
    return this._queueOutgoing.shift();
  }
}
