import { ChannelManager } from "../model/ChannelManager";
import { PhysicalPortHost } from "../model/PhysicalPortHost";
import { ControlMessage } from "../model/Channel";
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
      case "REQUEST": {
        //remote client want to fire an http request
        const { cid, opt } = msg.data;
        console.log(this._channelManager.name, "代理端点-接收控制消息-REQUEST", cid, opt);
        const channel = this._channelManager.getChannel(cid);
        if (channel) {
          redirectRequestToChn(opt as RequestOptions, channel);
          channel.once("finish", () => this._channelManager.deleteChannel(channel));
        }
        break;
      }
      case "CONNECT": {
        //remote client want to fire a socket connect
        const { cid, opt } = msg.data;
        const channel = this._channelManager.getChannel(cid);

        console.log("代理端点-接收控制消息-CONNECT", cid, opt);

        if (channel) {
          redirectConnectToChn(opt as NetConnectOpts, channel, () => {
            console.log("代理端点-管道关闭-隧道即将关闭", cid);
            this._channelManager.deleteChannel(channel);
          });
        } else {
          console.log("代理端点-接收控制消息-CONNECT", "信道不存在", cid);
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
