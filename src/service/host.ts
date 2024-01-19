import { IncomingMessage, ServerResponse, request as _request, createServer } from "http";
import { NetConnectOpts, connect as _connect } from "net";
import internal from "stream";
import { SerialPort } from "serialport";
import { PhysicalPortHost } from "../model/PhysicalPortHost";
import { ChannelManager } from "../model/ChannelManager";
import { Channel, ControllerChannel, CtlMessageFlag } from "../model/Channel";

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
  serialPort: SerialPort;
  port?: number;
  listen?: string;
};

export class ProxyServer {
  private readonly _options: ProxyOptions;
  private readonly _host: PhysicalPortHost;
  private readonly _chnManager: ChannelManager;
  private readonly _ctl: ControllerChannel;

  constructor(options: ProxyOptions) {
    this._options = options;
    this._host = new PhysicalPortHost(this._options.serialPort);
    this._chnManager = new ChannelManager(this._host, "ProxyServer");
    this._ctl = this._chnManager.ctlChannel;
  }

  private connect(req: IncomingMessage, sock: internal.Duplex) {
    const u = new URL("http://" + req.url);
    let chn: Channel;

    const opt: NetConnectOpts = {
      port: parseInt(u.port) || 80,
      host: u.hostname,
    };

    const onEstablished = (msg: { data: number; tk: string }) => {
      console.log("代理服务器-收到请求反馈：", msg);
      const { data: cid, tk } = msg;

      chn = this._chnManager.createChannel(cid);
      console.log("代理服务器-隧道建立成功， 尝试建立Socket链接", chn.cid);
      this._ctl.sendCtlMessage(
        {
          cmd: "CONNECT",
          tk,
          flag: CtlMessageFlag.CONTROL,
          data: { cid, opt },
        },
        null
      );

      chn.on("error", (e: any) => {
        console.log("ERROR", e);
        sock.push(null);
      });
      sock.on("error", e => {
        console.log("ERROR", e);
        chn.push(null);
      });

      sock.once("close", () => {
        console.log("SOCKET CLOSE");
        this._chnManager.deleteChannel(chn);
      });

      chn.pipe(sock);
      sock.pipe(chn);
    };

    console.log("代理服务器-尝试建立隧道...");
    this._ctl.sendCtlMessage(
      {
        cmd: "ESTABLISH",
        tk: null,
        flag: CtlMessageFlag.CONTROL,
      },
      onEstablished as any
    );
  }

  private request(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url);
    let chn: Channel;

    const opt = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: req.method,
      headers: req.headers,
    };

    const onEstablished = (msg: { data: number; tk: string }) => {
      console.log("代理服务器-收到请求反馈：", msg);
      const { data: cid, tk } = msg;

      chn = this._chnManager.createChannel(cid);
      console.log("代理服务器-隧道建立成功， 尝试建立请求", chn.cid);
      this._ctl.sendCtlMessage(
        {
          cmd: "REQUEST",
          tk,
          flag: CtlMessageFlag.CONTROL,
          data: { cid, opt },
        },
        null
      );

      chn.on("error", (e: any) => {
        console.log("ERROR", e);
        res.end();
      });
      res.on("error", e => {
        console.log("ERROR", e);
        chn.push(null);
      });
      res.once("close", () => {
        console.log("SOCKET CLOSE");
        this._chnManager.deleteChannel(chn);
      });

      chn.pipe(res);
      req.pipe(chn);
    };

    console.log("代理服务器-尝试建立隧道...");
    this._ctl.sendCtlMessage(
      {
        cmd: "ESTABLISH",
        tk: null,
        flag: CtlMessageFlag.CONTROL,
      },
      onEstablished as any
    );
  }

  public listen() {
    // const port = parseInt(getOption("port", "p", "13808"));
    // const listen = getOption("listen", "l", "0.0.0.0");
    // const serialPort = getOption("serial-port", "sp", ".");

    this._host.start();
    createServer()
      .on("request", this.request.bind(this))
      .on("connect", this.connect.bind(this))
      .listen(this._options.port || 13808, this._options.listen || "0.0.0.0");
  }
}
