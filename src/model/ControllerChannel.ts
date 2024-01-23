import { PhysicalPort } from "./PhysicalPort";
import { ChannelManager } from "./ChannelManager";
import getNextRandomToken from "../utils/random";
import {
  Channel,
  CtlMessageCallback,
  CtlMessageHandler,
  ControlMessage,
  CtlMessageFlag,
  CtlMessageCommand,
} from "./Channel";

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
