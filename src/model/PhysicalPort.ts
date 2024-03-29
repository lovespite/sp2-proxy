import { SerialPort } from "serialport";
import { Frame } from "./Frame";
import delay from "../utils/delay";
import {
  FrameBeg,
  FrameEnd,
  buildFrameBuffer,
  parseFrameBuffer,
} from "../utils/frame";
import { ReadFrameParser } from "./ReadFrameParser";
import { Transform } from "stream";

type OnFrameReceivedEvent = (pack: Frame) => void | Promise<void>;

export class PhysicalPort {
  private readonly _queueIncoming: Frame[];
  private readonly _queueOutgoing: Frame[];

  private readonly _physical: SerialPort;
  private readonly _parser: Transform;
  private readonly _frameEventList: Set<OnFrameReceivedEvent> = new Set();

  private _isDestroyed: boolean = false;
  private _isRunning: boolean = false;
  private _isFinished: boolean = false;

  private _trafficIn: bigint = BigInt(0);
  private _trafficOut: bigint = BigInt(0);

  public get traffic() {
    const t_in = this._trafficIn;
    const t_out = this._trafficOut;
    return {
      t_in: `${t_in} (${(t_in / 1024n).toString()} KB)`,
      t_out: `${t_out} (${(t_out / 1024n).toString()} KB)`,
    };
  }

  private readonly _frameBeg: Buffer = Buffer.from([FrameBeg]);
  private readonly _frameEnd: Buffer = Buffer.from([FrameEnd]);

  public get backPressure() {
    return this._queueOutgoing.length;
  }

  constructor(port: SerialPort) {
    this._physical = port;
    this._physical.on("error", console.error);
    this._physical.on("close", () => {
      console.error("[PPH]", "Physical port closed unexpectedly.");
      process.exit(1);
    });

    this._queueIncoming = [];
    this._queueOutgoing = [];

    this._parser = port.pipe(new ReadFrameParser());
    this._parser.on("data", this.onReceivedInternal.bind(this));

    console.log("[PPH]", "Port opened: ", port.path, " @ ", port.baudRate);
  }

  public get path() {
    return this._physical.path;
  }

  public get baudRate() {
    return this._physical.baudRate;
  }

  public async waitForFinish() {
    while (!this._isFinished) {
      await delay(100);
    }
  }

  public enqueueOut(packs: Frame[]) {
    if (this._isDestroyed || !this._isRunning) {
      throw new Error("Port is not running.");
    }

    this._queueOutgoing.push(...packs);
  }

  public publishCtlMessage(msg: string) {
    if (this._isDestroyed || !this._isRunning) {
      throw new Error("Port is not running.");
    }

    const cid = 0;
    const buffer = Buffer.from(msg, "utf8");

    const data = buildFrameBuffer(buffer, cid);

    this._queueOutgoing.unshift({
      channelId: cid,
      id: 0,
      data,
      length: buffer.length,
    });
  }

  public onFrameReceived(event: OnFrameReceivedEvent) {
    this._frameEventList.add(event);
  }

  public offFrameReceived(event: OnFrameReceivedEvent) {
    this._frameEventList.delete(event);
  }

  public async start() {
    if (this._isDestroyed) {
      throw new Error("Port is destroyed.");
    }

    if (this._isRunning) {
      throw new Error("Port is already running.");
    }

    this._isRunning = true;
    await Promise.all([
      this.startSendingDequeueTask(),
      this.startReceivingDequeueTask(),
    ]);
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
    this._frameEventList.clear();
    this._queueIncoming.length = 0;
    this._queueOutgoing.length = 0;
  }

  private onReceivedInternal(data: Buffer) {
    try {
      const pack = parseFrameBuffer(data);
      this._queueIncoming.push(pack);
    } catch (e) {
      console.error("[PPH]", "M_ERROR", e.message, "\n", data.toString("hex"));
    }
  }

  private async startSendingDequeueTask() {
    try {
      while (true) {
        if (!this._isRunning && this._queueOutgoing.length === 0) break; // no more data to send
        const pack = await this.blockDequeueOut();
        if (!pack) continue;

        if (!this._physical) break;

        this._trafficOut += BigInt(pack.data.length);
        this._physical.write(
          Buffer.concat([this._frameBeg, pack.data, this._frameEnd])
        );

        await new Promise((res) => this._physical.drain(res));
        if (!pack.keepAlive) pack.data = null; // release memory
      }
    } catch (e) {
      console.error(e.message);
    }
    this._isFinished = true;
  }

  private async emitPackReceived(pack: Frame) {
    for (const cb of this._frameEventList) {
      try {
        await cb(pack);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private async startReceivingDequeueTask() {
    try {
      while (this._isRunning) {
        const pack = await this.blockDequeueIn();

        if (!pack) continue;
        this._trafficIn += BigInt(pack.data.length);

        this.emitPackReceived(pack);
      }
    } catch (e) {
      console.error(e.message);
    }
  }

  private async blockDequeueIn(): Promise<Frame> {
    while (this._queueIncoming.length === 0) {
      await delay(100);
      if (!this._isRunning) throw new Error("Port stopped.");
    }
    return this._queueIncoming.shift();
  }

  private async blockDequeueOut(): Promise<Frame | undefined> {
    while (this._queueOutgoing.length === 0) {
      await delay(100);
      if (!this._isRunning) return;
    }
    return this._queueOutgoing.shift();
  }
}
