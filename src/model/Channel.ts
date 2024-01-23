import { Duplex } from "stream";
import { Frame } from "./Frame";
import { PhysicalPort } from "./PhysicalPort";
import { ChannelManager } from "./ChannelManager";
import getNextRandomToken from "../utils/random";
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

export class ControllerChannel extends Channel {
  private readonly _cbQueue: Map<string, CtlMessageCallback> = new Map();
  private readonly _ctlMsgHandlers: Set<CtlMessageHandler> = new Set();

  private readonly _channelManager: ChannelManager;
  constructor(host: PhysicalPort, man: ChannelManager) {
    super(0, host);
    this._channelManager = man;
  }

  public onCtlMessageReceived(cb: CtlMessageHandler) {
    this._ctlMsgHandlers.add(cb);
  }

  public offCtlMessageReceived(cb: CtlMessageHandler) {
    this._ctlMsgHandlers.delete(cb);
  }

  private invokeCtlMessageHandlers(m: ControlMessage) {
    const sb = this.sendCtlMessage.bind(this);
    for (const cb of this._ctlMsgHandlers) cb(m, sb);
  }

  public sendCtlMessage(msg: ControlMessage, cb?: CtlMessageCallback) {
    msg.tk = msg.tk || getNextRandomToken();

    let jsonMessage = JSON.stringify(msg);

    this._host.publishCtlMessage(jsonMessage);
    if (cb) this._cbQueue.set(msg.tk, cb);
  }

  public processCtlMessageInternal(msg: string) {
    try {
      const m = JSON.parse(msg) as ControlMessage;

      if (!m.tk) return;

      if (m.flag === CtlMessageFlag.CALLBACK) {
        const cb = this._cbQueue.get(m.tk);
        // 回调消息
        if (cb) {
          this._cbQueue.delete(m.tk);
          cb(m);
        }
      } else {
        // 控制消息
        this.dispatchCtlMessage(m);
      }
    } catch (e) {
      console.error("[Controller]", "Dispactching error:", e, msg);
    }
  }

  private dispatchCtlMessage(msg: ControlMessage) {
    switch (msg.cmd) {
      case CtlMessageCommand.ESTABLISH: {
        msg.data = this._channelManager.createChannel().cid;
        msg.flag = CtlMessageFlag.CALLBACK;

        this.sendCtlMessage(msg);
        break;
      }
      case CtlMessageCommand.DISPOSE: {
        this._channelManager.deleteChannel(msg.data);
        break;
      }
      default:
        this.invokeCtlMessageHandlers(msg);
        break;
    }
  }
}
