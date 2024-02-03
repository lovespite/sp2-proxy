import {
  IncomingMessage,
  ServerResponse,
  request as _request,
  createServer,
} from "http";
import { NetConnectOpts, connect as _connect } from "net";
import internal from "stream";
import { SerialPort } from "serialport";
import { PhysicalPort } from "../model/PhysicalPort";
import {
  ChannelManager,
  EstablishChannelTimeoutError,
} from "../model/ChannelManager";
import { Channel } from "../model/Channel";
import { CtlMessageCommand, CtlMessageFlag } from "../model/ControllerChannel";
import { ControllerChannel } from "../model/ControllerChannel";
import getNextRandomToken from "../utils/random";

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
};

export class ProxyServer {
  private readonly _options: ProxyOptions;
  private readonly _hosts: PhysicalPort[];
  private readonly _chnManager: ChannelManager;
  private readonly _ctl: ControllerChannel;

  constructor(options: ProxyOptions) {
    this._options = options;
    this._hosts = options.serialPorts.map((port) => new PhysicalPort(port));

    this._chnManager = new ChannelManager(this._hosts[0], "ProxyServer");
    this._chnManager.bindHosts(this._hosts.slice(1));

    this._ctl = this._chnManager.controller;
  }

  private async connect(req: IncomingMessage, sock: internal.Duplex) {
    const u = new URL("http://" + req.url);

    const opt: NetConnectOpts = {
      port: parseInt(u.port) || 80,
      host: u.hostname,
    };

    try {
      console.log("[Channel/Socket]", "Connecting", u.href, u.port);
      const chn = await this._chnManager.requireConnection();
      console.log("[Channel/Socket]", chn.path, chn.cid, "conn established.");

      this._ctl.sendCtlMessage(
        {
          cmd: CtlMessageCommand.CONNECT,
          tk: getNextRandomToken(),
          flag: CtlMessageFlag.CONTROL,
          data: { cid: chn.cid, opt },
        },
        null
      );

      chn.on("error", (e: any) => {
        console.log("ERROR", e);
        sock.push(null);
      });
      sock.on("error", (e) => {
        console.log("ERROR", e);
        chn.push(null);
      });

      sock.once("close", () => this._chnManager.kill(chn));

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
      .on("connect", this.connect.bind(this))
      .listen(this._options.port || 13808, this._options.listen || "0.0.0.0");
  }
}
