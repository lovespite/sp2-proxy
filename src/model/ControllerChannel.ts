import { PhysicalPort } from "./PhysicalPort";
import { Controller } from "./ChannelManager";
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
    for (const cb of this._ctlMsgHandlers) {
      cb(m, sb);
    }
  }

  private sendCtlMessage(msg: ControlMessage, cb?: CtlMessageCallback) {
    msg.tk = msg.tk || getNextRandomToken();

    let jsonMessage = JSON.stringify(msg);

    this._host.publishCtlMessage(jsonMessage);
    if (cb) this._cbQueue.set(msg.tk, cb);
  }

  /**
   * Send a control message to the remote side, and wait for the response
   * This is typically used for RPC
   * @param msg
   * @param timeout If timeout is set to <= 0, then it will never timeout
   * @param noReturn If set to true, then it will not wait for the response,
   * and the return value is always null
   * @returns
   */
  public callRemoteProc(
    msg: Partial<ControlMessage>,
    timeout: number = 5000,
    noReturn: boolean = false
  ): Promise<ControlMessage> {
    return new Promise((resolve, reject) => {
      msg.tk = msg.tk || getNextRandomToken();
      msg.flag = msg.flag || CtlMessageFlag.CONTROL;

      this.sendCtlMessage(msg as any, noReturn ? null : listener);

      if (noReturn) {
        resolve(null);
        return;
      }

      const th =
        timeout > 0
          ? setTimeout(() => {
              reject(new RpcTimeoutError());
            }, timeout)
          : null;

      function listener(msg: ControlMessage) {
        th && clearTimeout(th);
        resolve(msg);
      }
    });
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

export class RpcTimeoutError extends Error {
  constructor() {
    super("RPC timeout");
  }
}
