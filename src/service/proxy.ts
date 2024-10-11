import { ChannelManager } from "../model/ChannelManager";
import { PhysicalPort } from "../model/PhysicalPort";
import { ControlMessage, CtlMessageCommand } from "../model/ControllerChannel";
import { RequestOptions } from "http";
import { TcpNetConnectOpts } from "net";
import * as request from "./request";
import { ProxyOptions } from "./host";
import { Rule } from "./rule";

export default class ProxyEndPoint {
  private readonly _hosts: PhysicalPort[];
  private readonly _channelManager: ChannelManager;
  private _rule: Rule;

  constructor(options: ProxyOptions) {
    this._hosts = options.serialPorts.map((port) => new PhysicalPort(port));
    this._channelManager = new ChannelManager(this._hosts[0], "ProxyEndPoint");
    this._channelManager.bindHosts(this._hosts.slice(1));
  }

  private async onCtlMessageReceived(msg: ControlMessage) {
    switch (msg.cmd) {
      case CtlMessageCommand.CONNECT: {
        //remote client want a socket connection
        const { cid, opt, v } = msg.data as {
          cid: number;
          opt: TcpNetConnectOpts;
          v: number;
        };
        const channel = this._channelManager.get(cid);

        if (this._rule) {
          const [host, port] = await this._rule.getAsync(opt.host, opt.port);

          opt.host = host;
          opt.port = port;
        }

        console.log(
          "[ProxyEndPoint/Socket]",
          channel.path,
          cid,
          "Connecting",
          opt.host,
          opt.port
        );

        if (channel) {
          if (v === 5) {
            // socks5 proxy
            request.redirectSocks5ToChn(opt, channel, () => {
              console.log("[ProxyEndPoint/Socks5]", cid, "Channel is closing.");
              this._channelManager.kill(channel, 0x1);
            });
          } else if (v === 0) {
            // http proxy
            request.redirectConnectToChn(opt, channel, () => {
              console.log("[ProxyEndPoint/Socket]", cid, "Channel is closing.");
              this._channelManager.kill(channel, 0x1);
            });
          }
        } else {
          console.log("[ProxyEndPoint/Socket]", "Channel not found:", cid);
        }

        break;
      }
      case CtlMessageCommand.REQUEST: {
        //remote client want an http request
        const { cid, opt } = msg.data;

        const channel = this._channelManager.get(cid);

        console.log(
          "[ProxyEndPoint/Request]",
          channel.path,
          cid,
          "Connecting",
          opt
        );

        if (channel) {
          request.redirectRequestToChn(opt as RequestOptions, channel, () => {
            console.log("[ProxyEndPoint/Request]", cid, "Channel is closing.");
            this._channelManager.kill(channel, 0x2);
          });
          channel.once("finish", () => this._channelManager.kill(channel, 0x3));
        } else {
          console.log("[ProxyEndPoint/Request]", "Channel not found:", cid);
        }

        break;
      }
    }
  }

  public async proxy() {
    const ctl = this._channelManager.controller;
    this._rule = await Rule.loadRule();

    ctl.onCtlMessageReceived(this.onCtlMessageReceived.bind(this));
    await Promise.all(this._hosts.map((host) => host.start()));
  }
}
