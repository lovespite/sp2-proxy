import { IncomingMessage, request as _request, createServer } from "http";
import { NetConnectOpts, connect as _connect } from "net";
import internal from "stream";
import { RegexParser, SerialPort } from "serialport";
import { PhysicalPort } from "../model/PhysicalPort";
import { ChannelManager } from "../model/ChannelManager";
import { CtlMessageCommand } from "../model/ControllerChannel";
import { ControllerChannel } from "../model/ControllerChannel";
import * as fsys from "../utils/fsys";

// function request(cReq: IncomingMessage, cRes: ServerResponse) {
//   const u = new URL(cReq.url);

//   const options = {
//     hostname: u.hostname,
//     port: u.port || 80,
//     path: u.pathname + u.search,
//     method: cReq.method,
//     headers: cReq.headers,
//   };

//   console.log("FETCH", u.href);

//   const pReq = _request(options, function (pRes) {
//     cRes.writeHead(pRes.statusCode, pRes.headers);
//     pRes.pipe(cRes);
//   }).on("error", function (e) {
//     console.log("ERROR", cReq.url, e);
//     cRes.end();
//   });

//   cReq.pipe(pReq);
// }

// function connect(cReq: IncomingMessage, cSock: internal.Duplex) {
//   const u = new URL("http://" + cReq.url);

//   const options: NetConnectOpts = {
//     port: parseInt(u.port) || 80,
//     host: u.hostname,
//   };

//   console.log("CONNECT", u.href);

//   const pSock = _connect(options, function () {
//     cSock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
//     pSock.pipe(cSock);
//   }).on("error", function (e) {
//     console.log("ERROR", cReq.url, e);
//     cSock.end();
//   });

//   cSock.pipe(pSock);
// }

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

  private async connect(req: IncomingMessage, sock: internal.Duplex) {
    const u = new URL("http://" + req.url);

    const opt: NetConnectOpts = {
      port: parseInt(u.port) || 443,
      host: u.hostname,
    };

    try {
      const chn = await this._chnManager.requireConnection();
      console.log("[Channel/Socket]", chn.path, chn.cid, "conn established.");

      await this._ctl.callRemoteProc(
        {
          cmd: CtlMessageCommand.CONNECT,
          data: { cid: chn.cid, opt },
        },
        5000,
        true
      );

      chn.on("error", (e: any) => {
        console.log("ERROR", e);
        sock.push(null);
      });
      sock.on("error", (e) => {
        console.log("ERROR", e);
        chn.push(null);
      });

      sock.once("close", () => this._chnManager.kill(chn, 0x4));

      chn.pipe(sock);
      sock.pipe(chn);
    } catch (e) {
      sock.end();
    }
  }

  // private request(req: IncomingMessage, res: ServerResponse) {
  //   const u = new URL(req.url);
  //   let chn: Channel;

  //   const opt = {
  //     hostname: u.hostname,
  //     port: u.port || 80,
  //     path: u.pathname + u.search,
  //     method: req.method,
  //     headers: req.headers,
  //   };

  //   const onEstablished = (msg: { data: number; tk: string }) => {
  //     const { data: cid, tk } = msg;

  //     chn = this._chnManager.createChannel(cid);

  //     console.log(
  //       "[Channel/Request]",
  //       chn.path,
  //       chn.cid,
  //       "Connection established."
  //     );
  //     this._ctl.sendCtlMessage(
  //       {
  //         cmd: CtlMessageCommand.REQUEST,
  //         tk,
  //         flag: CtlMessageFlag.CONTROL,
  //         data: { cid, opt },
  //       },
  //       null
  //     );

  //     chn.on("error", (e: any) => {
  //       console.error("ERROR", e);
  //       res.end();
  //     });
  //     res.on("error", (e) => {
  //       console.error("ERROR", e);
  //       chn.push(null);
  //     });
  //     res.once("close", () => {
  //       this._chnManager.deleteChannel(chn);
  //     });

  //     chn.pipe(res);
  //     req.pipe(chn);
  //   };

  //   console.log("[Channel/Request]", "Connecting", u.href, u.port);
  //   this._ctl.sendCtlMessage(
  //     {
  //       cmd: CtlMessageCommand.ESTABLISH,
  //       tk: null,
  //       flag: CtlMessageFlag.CONTROL,
  //     },
  //     onEstablished as any
  //   );
  // }

  public listen() {
    this._hosts.forEach((host) => host.start());
    createServer()
      // .on("request", this.request.bind(this))
      .on("connect", (req, cSock) => {
        if (!this._pac || this._pac.isProxy(req.url)) {
          this.connect(req, cSock);
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
