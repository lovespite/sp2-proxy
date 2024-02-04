import { PhysicalPort } from "./PhysicalPort";
import { ChannelManager, Controller } from "./ChannelManager";
import getNextRandomToken from "../utils/random";
import { Channel } from "./Channel";

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
  cmd: CtlMessageCommand | string;
  flag: CtlMessageFlag; // 0 => ctl message, 1 => callback message
  data?: any;
  keepAlive?: boolean;
};

export type CtlMessageCallback = (mReceived: ControlMessage) => void;
export type CtlMessageSendBackDelegate = (mToSend: ControlMessage) => void;
export type CtlMessageHandler = (
  mReceived: ControlMessage,
  sendBack: CtlMessageSendBackDelegate
) => void;

export type AsyncCtlMessageHandler = (
  mReceived: ControlMessage,
  sendBack: CtlMessageSendBackDelegate
) => Promise<void>;

export class ControllerChannel extends Channel {
  private readonly _ctl: Controller;

  private readonly _cbQueue: Map<string, CtlMessageCallback> = new Map();
  private readonly _ctlMsgHandlers: Set<CtlMessageHandler> = new Set();

  constructor(host: PhysicalPort, controller: Controller) {
    super(0, host);
    this._ctl = controller;
  }

  public onCtlMessageReceived(cb: CtlMessageHandler | AsyncCtlMessageHandler) {
    this._ctlMsgHandlers.add(cb);
  }

  public offCtlMessageReceived(cb: CtlMessageHandler | AsyncCtlMessageHandler) {
    this._ctlMsgHandlers.delete(cb);
  }

  private async invokeCtlMessageHandlers(m: ControlMessage) {
    const sb = this.sendCtlMessage.bind(this);
    for (const cb of this._ctlMsgHandlers) await cb(m, sb);
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
          if (!m.keepAlive) this._cbQueue.delete(m.tk);
          cb(m);

          console.log("Callback:", m);
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
        msg.data = this._ctl.openChannel().cid;
        msg.flag = CtlMessageFlag.CALLBACK;

        this.sendCtlMessage(msg);
        break;
      }
      case CtlMessageCommand.DISPOSE: {
        this._ctl.closeChannel(msg.data, (msg as any).code || 0xfa21);
        msg.flag = CtlMessageFlag.CALLBACK;

        this.sendCtlMessage(msg);
        break;
      }
      default:
        this.invokeCtlMessageHandlers(msg);
        break;
    }
  }
}
