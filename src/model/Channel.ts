import { Duplex } from "stream";
import { Frame } from "./Frame";
import { PhysicalPort } from "./PhysicalPort";
import { buildNullFrameObj, slice } from "../utils/frame";

export enum CtlMessageFlag {
  CONTROL = 0,
  CALLBACK = 1,
}

export enum CtlMessageCommand {
  ESTABLISH = "E",
  DISPOSE = "D",
  CONNECT = "C",
  REQUEST = "R",
}

export type ControlMessage = {
  tk: string | null;
  cmd: CtlMessageCommand;
  flag: CtlMessageFlag; // 0 => ctl message, 1 => callback message
  data?: any;
};

export type CtlMessageCallback = (mReceived: ControlMessage) => void;
export type CtlMessageSendBackDelegate = (mToSend: ControlMessage) => void;
export type CtlMessageHandler = (mReceived: ControlMessage, sendBack: CtlMessageSendBackDelegate) => void;

export class Channel extends Duplex {
  protected readonly _host: PhysicalPort;
  private readonly _id: number;
  private readonly _streamBufferIn: any[];

  private _finished: boolean = false;

  private readonly _nullPack: Frame;

  public get cid() {
    return this._id;
  }

  constructor(id: number, host: PhysicalPort) {
    super();
    this._host = host;
    this._id = id;
    this._streamBufferIn = [];

    // a zero-length frame
    this._nullPack = buildNullFrameObj(this._id, true);

    this.once("finish", () => {
      // send a zero-length frame to notify the other side that the stream is finished.
      this._host.enqueueOut([this._nullPack]);
    });
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error) => void): void {
    let packs: Frame[];

    if (chunk instanceof Buffer) {
      packs = slice(chunk, this._id);
    } else {
      packs = slice(Buffer.from(chunk, encoding), this._id);
    }

    this._host.enqueueOut(packs);

    callback();
  }

  _read(size: number): void {
    const data = this._streamBufferIn.shift();
    if (!data) {
      if (this._finished) {
        this.push(null);
      } else {
        return;
      }
    } else {
      this.push(data);
    }
  }

  public pushBufferExternal(buffer: Buffer | null) {
    if (buffer === null) {
      this._finished = true; // 标记结束
    } else {
      if (this._streamBufferIn.length === 0) {
        this.push(buffer); // 直接推送
      } else {
        // 如果队列中有待处理数据，先入队
        this._streamBufferIn.push(buffer); // 入队
        console.warn("[Channel]", "EXT_DATA", buffer ? buffer.length : "[END]", "[QUEUED]");
      }
    }
  }

  _destroy(error: Error, callback: (error?: Error) => void): void {
    this.push(null);
    this._streamBufferIn.length = 0;
    callback();
  }
}
