import { ChannelManager } from "../model/ChannelManager";
import { PhysicalPort } from "../model/PhysicalPort";
import { ControlMessage, CtlMessageCommand } from "../model/ControllerChannel";
import { RequestOptions } from "http";
import { NetConnectOpts } from "net";
import { redirectRequestToChn, redirectConnectToChn } from "./request";
import { ProxyOptions } from "./host";

export default class ProxyEndPoint {
  private readonly _options: ProxyOptions;
  private readonly _hosts: PhysicalPort[];
  private readonly _channelManager: ChannelManager;

  constructor(options: ProxyOptions) {
    this._options = options;
    this._hosts = options.serialPorts.map((port) => new PhysicalPort(port));
    this._channelManager = new ChannelManager(this._hosts[0], "ProxyEndPoint");
    this._channelManager.bindHosts(this._hosts.slice(1));
  }

  private onCtlMessageReceived(msg: ControlMessage) {
    switch (msg.cmd) {
      case CtlMessageCommand.CONNECT: {
        //remote client want a socket connection
        const { cid, opt } = msg.data;
        const channel = this._channelManager.getChannel(cid);

        console.log(
          "[ProxyEndPoint/Socket]",
          channel.path,
          cid,
          "Connecting",
          opt
        );

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

        const channel = this._channelManager.getChannel(cid);

        console.log(
          "[ProxyEndPoint/Request]",
          channel.path,
          cid,
          "Connecting",
          opt
        );

        if (channel) {
          redirectRequestToChn(opt as RequestOptions, channel, () => {
            console.log("[ProxyEndPoint/Request]", cid, "Channel is closing.");
            this._channelManager.deleteChannel(channel);
          });
          channel.once("finish", () =>
            this._channelManager.deleteChannel(channel)
          );
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
    await Promise.all(this._hosts.map((host) => host.start()));
  }
}
