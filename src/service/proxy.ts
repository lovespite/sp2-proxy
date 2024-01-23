import { ChannelManager } from "../model/ChannelManager";
import { PhysicalPortHost } from "../model/PhysicalPortHost";
import { ControlMessage, CtlMessageCommand } from "../model/Channel";
import { RequestOptions } from "http";
import { NetConnectOpts } from "net";
import { redirectRequestToChn, redirectConnectToChn } from "./request";
import { ProxyOptions } from "./host";

export default class ProxyEndPoint {
  private readonly _options: ProxyOptions;
  private readonly _host: PhysicalPortHost;
  private readonly _channelManager: ChannelManager;

  constructor(options: ProxyOptions) {
    this._options = options;
    this._host = new PhysicalPortHost(this._options.serialPort);
    this._channelManager = new ChannelManager(this._host, "ProxyEndPoint");
  }

  private onCtlMessageReceived(msg: ControlMessage) {
    switch (msg.cmd) {
      case CtlMessageCommand.CONNECT: {
        //remote client want a socket connection
        const { cid, opt } = msg.data;
        const channel = this._channelManager.getChannel(cid);

        console.log("[ProxyEndPoint/Socket]", cid, "Connecting", opt);

        if (channel) {
          redirectConnectToChn(opt as NetConnectOpts, channel, () => {
            console.log("[ProxyEndPoint/Socket]", cid, "Channel is closing.");
            this._channelManager.deleteChannel(channel);
          });
        } else {
          console.log("[ProxyEndPoint/Socket]", "Channel not found:", cid);
        }

        break;
      }
      case CtlMessageCommand.REQUEST: {
        //remote client want an http request
        const { cid, opt } = msg.data;

        console.log("[ProxyEndPoint/Request]", cid, "Connecting", opt);

        const channel = this._channelManager.getChannel(cid);

        if (channel) {
          redirectRequestToChn(opt as RequestOptions, channel, () => {
            console.log("[ProxyEndPoint/Request]", cid, "Channel is closing.");
            this._channelManager.deleteChannel(channel);
          });
          channel.once("finish", () => this._channelManager.deleteChannel(channel));
        } else {
          console.log("[ProxyEndPoint/Request]", "Channel not found:", cid);
        }

        break;
      }
    }
  }

  public async proxy() {
    const ctl = this._channelManager.ctlChannel;

    ctl.onCtlMessageReceived(this.onCtlMessageReceived.bind(this));
    await this._host.start();
  }
}
