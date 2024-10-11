import { IncomingMessage, request as _request, createServer } from "http";
import { NetConnectOpts, connect as _connect } from "net";
import internal from "stream";
import { RegexParser, SerialPort } from "serialport";
import { PhysicalPort } from "../model/PhysicalPort";
import { ChannelManager } from "../model/ChannelManager";
import { CtlMessageCommand } from "../model/ControllerChannel";
import { ControllerChannel } from "../model/ControllerChannel";
import * as fsys from "../utils/fsys";
import { socks5 } from "./socks5/index";
import S5Proxy, { S5ProxyRequest } from "./socks5/proxy";

export type ProxyOptions = {
  serialPorts: SerialPort[];
  port?: number;
  listen?: string;
  rule?: string;
};

export class ProxyServer {
  private readonly _options: ProxyOptions;
  private readonly _hosts: PhysicalPort[];
  private readonly _chnManager: ChannelManager;
  private readonly _ctl: ControllerChannel;
  private readonly _pac: Pac;

  constructor(options: ProxyOptions, pac: Pac) {
    this._options = options;
    this._hosts = options.serialPorts.map((port) => new PhysicalPort(port));

    this._chnManager = new ChannelManager(this._hosts[0], "ProxyServer");
    this._chnManager.bindHosts(this._hosts.slice(1));

    this._ctl = this._chnManager.controller;
    this._pac = pac;
  }

  private async connect(
    sock: internal.Duplex,
    version: 0 | 5,
    req: IncomingMessage | null,
    hostname: string | null,
    port: number | null,
    onsuccess: () => void = () => {}
  ) {
    const opt: NetConnectOpts = {
      port: 443,
      host: "",
    };

    if (hostname) {
      opt.host = hostname;
      opt.port = port || 443;
    } else if (req) {
      const u = new URL("http://" + req.url);
      opt.host = u.hostname;
      opt.port = parseInt(u.port) || 443;
    } else {
      sock.end();
      return;
    }

    try {
      const chn = await this._chnManager.requireConnection();
      console.log("[Channel/Socket]", chn.path, chn.cid, "conn established.");

      await this._ctl.callRemoteProc(
        {
          cmd: CtlMessageCommand.CONNECT,
          data: { cid: chn.cid, opt, v: version },
        },
        5000,
        true
      );

      chn.on("error", () => sock.push(null));
      sock.on("error", () => chn.push(null));

      sock.once("close", () => this._chnManager.kill(chn, 0x4));

      onsuccess();

      chn.pipe(sock);
      sock.pipe(chn);
    } catch (e) {
      sock.end();
    }
  }

  private startHosts() {
    this._hosts.forEach((host) => host.start());
  }

  public listenOnSocks5() {
    this.startHosts();
    socks5({
      host: this._options.listen || "0.0.0.0",
      port: this._options.port || 13808,
      callback: this.socks5Request.bind(this),
    });
  }

  private async socks5Request(req: S5ProxyRequest, proxy: S5Proxy) {
    const targetHostname = req.domain || req.ip;
    const targetPort = req.port;
    console.log(
      "[ProxyServer/Socks5]",
      "Connecting",
      targetHostname,
      targetPort
    );

    this.connect(proxy.socket, 5, null, targetHostname, targetPort, () => {
      proxy.replySuccess();
      console.log(
        "[ProxyServer/Socks5]",
        "Connected",
        targetHostname,
        targetPort
      );
    });
  }

  public listen() {
    this.startHosts();
    createServer()
      // .on("request", this.request.bind(this))
      .on("connect", (req, cSock) => {
        if (!this._pac || this._pac.isProxy(req.url)) {
          this.connect(cSock, 0, req, null, null);
          console.log("[ProxyServer/Socket]", "Connecting/Proxy", req.url);
        } else {
          const url = new URL("http://" + req.url);
          const pSock = _connect(
            {
              port: parseInt(url.port) || 443,
              host: url.hostname,
            },
            function () {
              cSock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
              pSock.pipe(cSock);
            }
          ).on("error", function (e) {
            console.log("ERROR", req.url, e);
            cSock.end();
          });

          cSock.pipe(pSock);
          cSock
            .on("error", function (e) {
              console.log("ERROR", e);
            })
            .once("close", () => pSock.end());

          pSock.once("close", () => cSock.end());

          console.log("[ProxyServer/Socket]", "Connecting/Direct", req.url);
        }
      })
      .listen(this._options.port || 13808, this._options.listen || "0.0.0.0");
  }
}

/**
 *
PROXY WXAT http://127.0.0.1:13808

WXAT *.wuxiapptec.com
DIRECT *.baidu.com
DIRECT *.lovespite.com
DIRECT localhost
DIRECT localhost:*
 */

export class Pac {
  #_directRules = [] as RegExp[];
  #_proxyRules = [] as { rule: RegExp; proxy: string }[];

  static async loadFromPacFile(file: string) {
    const pac = new Pac();
    const lines = await fsys
      .read_file(file)
      .then((data) => (data as string).split("\n"));

    lines.forEach((line) => {
      if (!line) return;
      const ln = line.trim();
      if (ln.startsWith("#")) return;
      const parts = ln.split(/\s/).map((part) => part.trim());
      if (parts.length != 2) return; // not a rule

      const [proxy, pattern] = parts;

      const reg = new RegExp(
        pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".")
      );

      if (proxy.toUpperCase() === "DIRECT") {
        pac.#_directRules.push(reg);
      } else {
        pac.#_proxyRules.push({ rule: reg, proxy });
      }
    });

    return pac;
  }

  isProxy(host: string) {
    for (const p of this.#_proxyRules) {
      if (p.rule.test(host)) return true;
    }

    return false;
  }

  isDirect(host: string) {
    return this.#_directRules.some((reg) => reg.test(host));
  }
}
