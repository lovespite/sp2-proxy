import dns from "dns";
import net from "net";
import * as utils from "./utils";
import { assert } from "console";
import { Socket } from "net";
import { v1 as uuid } from "uuid";
import consts, { UnionType } from "./constant";

export type ProxyRequestConnectionCallback = (
  req: S5ProxyRequest,
  proxy: S5Proxy
) => Promise<any>;

const config = {
  auth_method: consts.METHODS.NO_AUTH,
  username: "admin",
  passwd: "admin",
};

export type S5ProxyRequest = {
  cmd: UnionType;
  rsv: number;
  atyp: UnionType;
  port: number;
  ip: string | null;
  domain: string | null;
};

type ProxySession = {
  id: string;
  buffer: Buffer;
  offset: number;
  state: number;
  method?: UnionType;
  dstSocket?: Socket;
};

export default class S5Proxy {
  private _callback: ProxyRequestConnectionCallback = null;

  constructor(socket: Socket) {
    this._socket = socket;
    this._session = {
      id: uuid(),
      buffer: Buffer.alloc(0),
      offset: 0,
      state: consts.STATE.METHOD_NEGOTIATION,
    };
    socket.on("data", this.handle.bind(this));
  }

  public set onConnection(callback: ProxyRequestConnectionCallback | null) {
    this._callback = callback;
  }

  public get sessionId() {
    return this._session.id;
  }

  /**
   * proxy socket
   */
  private readonly _socket: Socket;

  public get socket() {
    return this._socket;
  }

  /**
   * session
   */
  private readonly _session: ProxySession;

  private checkNull(offset: number, buf: Buffer = null) {
    buf = buf || this._session.buffer;
    if (!buf) return true;
    return typeof buf[offset] === undefined;
  }

  /**
   * The client connects to the server, and sends a version identifier/method selection message:
   * +----+----------+----------+
   * |VER | NMETHODS | METHODS  |
   * +----+----------+----------+
   * | 1  |    1     | 1 to 255 |
   * +----+----------+----------+
   */
  parseMethods() {
    const buf = this._session.buffer;
    let offset = this._session.offset;

    if (this.checkNull(offset)) return false;
    let socksVersion = buf[offset++];
    assert(
      socksVersion == consts.SOCKS_VERSION,
      `[Socks5/Connection] ${this._session.id} only support socks version 5, got [${socksVersion}]`
    );
    if (socksVersion != consts.SOCKS_VERSION) {
      this._socket.end();
      return false;
    }

    if (this.checkNull(offset)) return false;

    let methodLen = buf[offset++];
    assert(
      methodLen >= 1 && methodLen <= 255,
      `[Socks5/Connection] ${this._session.id} methodLen's value [${methodLen}] is invalid`
    );

    if (this.checkNull(offset + methodLen - 1)) return false;

    let methods: UnionType[] = [];
    for (let i = 0; i < methodLen; i++) {
      let method = consts.Querable.get(buf[offset++], consts.METHODS);
      if (method) {
        methods.push(method);
      }
    }

    console.log(
      `[Socks5/Connection] ${this._session.id} SOCKS_VERSION: ${socksVersion}`
    );
    console.log(`[Socks5/Connection] ${this._session.id} METHODS: `, methods);

    this._session.offset = offset;

    return methods;
  }

  /** socks server select auth method */
  selectMethod(methods: UnionType[]) {
    let method = consts.METHODS.NO_ACCEPTABLE;

    for (let i = 0; i < methods.length; i++) {
      if (methods[i] == config.auth_method) {
        method = config.auth_method;
      }
    }

    this._session.method = method;

    return method;
  }

  /**
   * The server selects from one of the methods given in METHODS, and sends a METHOD selection message
   * +----+--------+
   * |VER | METHOD |
   * +----+--------+
   * | 1  |   1    |
   * +----+--------+
   */
  replyMethod(method: UnionType) {
    this._socket.write(Buffer.from([consts.SOCKS_VERSION, method[0]]));
  }

  /**
   * This begins with the client producing a Username/Password request:
   * +----+------+----------+------+----------+
   * |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
   * +----+------+----------+------+----------+
   * | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
   * +----+------+----------+------+----------+
   */
  parseUsernamePasswd() {
    const buf = this._session.buffer;
    let offset = this._session.offset;

    const req: { username: string; passwd: string } = {
      username: "",
      passwd: "",
    };

    if (this.checkNull(offset)) return false;

    let authVersion = buf[offset++];
    assert(
      authVersion == consts.USERNAME_PASSWD_AUTH_VERSION,
      `[Socks5/Connection] ${this._session.id} only support auth version ${consts.USERNAME_PASSWD_AUTH_VERSION}, got [${authVersion}]`
    );
    if (authVersion != consts.USERNAME_PASSWD_AUTH_VERSION) {
      this._socket.end();
      return false;
    }

    if (this.checkNull(offset)) return false;

    let uLen = buf[offset++];
    assert(
      uLen >= 1 && uLen <= 255,
      `[Socks5/Connection] ${this._session.id} got wrong ULEN [${uLen}]`
    );
    if (uLen >= 1 && uLen <= 255) {
      if (this.checkNull(offset + uLen - 1)) return false;

      req.username = buf.slice(offset, offset + uLen).toString("utf8");
      offset += uLen;
    } else {
      this._socket.end();
      return false;
    }

    if (this.checkNull(offset)) return false;
    let pLen = buf[offset++];
    assert(
      pLen >= 1 && pLen <= 255,
      `[Socks5/Connection] ${this._session.id} got wrong PLEN [${pLen}]`
    );
    if (pLen >= 1 && pLen <= 255) {
      if (this.checkNull(offset + pLen - 1)) return false;
      // req.passwd = buf.slice(offset, offset + pLen).toString("utf8");
      // slice is deprecated
      req.passwd = buf.toString("utf8", offset, offset + pLen);
      offset += pLen;
    } else {
      this._socket.end();
      return false;
    }

    this._session.offset = offset;

    return req;
  }

  /**
   * The server verifies the supplied UNAME and PASSWD, and sends the following response:
   *  +----+--------+
   *  |VER | STATUS |
   *  +----+--------+
   *  | 1  |   1    |
   *  +----+--------+
   */
  replyAuth(succeeded: boolean) {
    let reply = [
      consts.USERNAME_PASSWD_AUTH_VERSION,
      succeeded ? consts.AUTH_STATUS.SUCCESS : consts.AUTH_STATUS.FAILURE,
    ];
    if (succeeded) {
      this._socket.write(Buffer.from(reply));
    } else {
      this._socket.end(Buffer.from(reply));
    }
  }

  /**
   * The SOCKS request is formed as follows:
   * +----+-----+-------+------+----------+----------+
   * |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
   * +----+-----+-------+------+----------+----------+
   * | 1  |  1  | X'00' |  1   | Variable |    2     |
   * +----+-----+-------+------+----------+----------+
   */
  parseRequests() {
    const buf = this._session.buffer;
    let offset = this._session.offset;

    // const req: ProxyRequest = {};

    if (this.checkNull(offset)) return false;

    let socksVersion = buf[offset++];
    assert(
      socksVersion == consts.SOCKS_VERSION,
      `[Socks5/Connection] ${this._session.id} only support socks version 5, got [${socksVersion}]`
    );

    if (socksVersion != consts.SOCKS_VERSION) {
      this._socket.end();
      return false;
    }

    if (this.checkNull(offset)) return false;
    const cmd =
      consts.Querable.get(buf[offset++], consts.REQUEST_CMD) || void 0;
    if (!cmd || cmd != consts.REQUEST_CMD.CONNECT) {
      // 不支持的 cmd || 暂时只支持 connect
      this._socket.end();
      return false;
    }

    if (this.checkNull(offset)) return false;
    const rsv = buf[offset++];
    assert(
      rsv == consts.RSV,
      `[Socks5/Connection] ${this._session.id} rsv should be ${consts.RSV}`
    );

    if (this.checkNull(offset)) return false;
    const atyp = consts.Querable.get(buf[offset++], consts.ATYP) || void 0;
    let ipArr: Uint8Array | null = null;
    let domain: string | null = null;
    if (!atyp) {
      // 不支持的 atyp
      this._socket.end();
      return false;
    } else if (atyp == consts.ATYP.IPV4) {
      const ipLen = 4;
      if (this.checkNull(offset + ipLen - 1)) return false;
      ipArr = buf.subarray(offset, offset + ipLen);
      offset += ipLen;
    } else if (atyp == consts.ATYP.FQDN) {
      if (this.checkNull(offset)) return false;
      let domainLen = buf[offset++];

      if (this.checkNull(offset + domainLen - 1)) return false;

      // req.domain = buf.slice(offset, offset + domainLen).toString("utf8");
      domain = buf.toString("utf8", offset, offset + domainLen);
      offset += domainLen;
    } else {
      // 其他暂时不支持
      this._socket.end();
      return false;
    }

    let portLen = 2;
    if (this.checkNull(offset + portLen - 1)) return false;
    const port = buf.readUInt16BE(offset);
    offset += portLen;

    const req: S5ProxyRequest = {
      cmd,
      rsv,
      atyp,
      port,
      ip: ipArr ? ipArr.join(".") : null,
      domain,
    };

    this._session.offset = offset;

    return req;
  }

  /**
   * The server evaluates the request, and returns a reply formed as follows:
   * +----+-----+-------+------+----------+----------+
   * |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
   * +----+-----+-------+------+----------+----------+
   * | 1  |  1  | X'00' |  1   | Variable |    2     |
   * +----+-----+-------+------+----------+----------+
   */
  dstConnect(req: S5ProxyRequest) {
    if (this._callback) {
      this._callback(req, this);
    } else {
      let dstHost = req.domain || req.ip;
      dns.lookup(dstHost, { family: 4 }, (err, ip) => {
        if (err || !ip) {
          // failure reply
          let reply = [
            consts.SOCKS_VERSION,
            consts.REP.HOST_UNREACHABLE[0],
            consts.RSV,
            consts.ATYP.IPV4[0],
          ]
            .concat(utils.ipbytes("127.0.0.1")) // ip: 127.0.0.1
            .concat([0x00, 0x00]); // port: 0x0000
          // close connection
          this._socket.end(Buffer.from(reply));
        } else {
          // connect target host
          this.connect(req, ip);
        }
      });
    }
  }

  private connect(req: S5ProxyRequest, ip: string) {
    const dstSocket: Socket = net.createConnection({
      port: req.port, // port from client's requests
      host: ip, // ip from dns lookup of socks proxy server
    });

    dstSocket
      .on("connect", () => {
        // success reply
        this.replySuccess();

        // pipe for proxy forward
        this._socket.pipe(dstSocket).pipe(this._socket);
      })
      .on("error", (err) => {
        console.error(
          `[Socks5/Connection] ${this._session.id} -> dstSocket`,
          err
        );
      })
      .on("end", () => {
        console.log(`[Socks5/Connection] ${this._session.id} -> dstSocket end`);
      })
      .on("close", () => {
        console.log(
          `[Socks5/Connection] ${this._session.id} -> dstSocket close`
        );
      });

    // save dstSocket to session
    this._session.dstSocket = dstSocket;
  }

  public get dstSocket() {
    return this._session.dstSocket;
  }

  public replySuccess() {
    let bytes = [
      consts.SOCKS_VERSION,
      consts.REP.SUCCEEDED[0],
      consts.RSV,
      consts.ATYP.IPV4[0],
    ]
      // dstSocket.localAddress or default 127.0.0.1
      .concat(utils.ipbytes(this.dstSocket?.localAddress || "127.0.0.1"))
      // default port 0x00
      .concat([0x00, 0x00]);

    let reply = Buffer.from(bytes);

    // use dstSocket.localPort override default port 0x0000
    // reply.writeUInt16BE(dstSocket.localPort, reply.length - 2);
    this._socket.write(reply);
  }

  /**
   * called by socket's 'data' event listener
   */
  handle(buf: Buffer) {
    // before proxy forward phase, otherwise do nothing
    if (this._session.state < consts.STATE.PROXY_FORWARD) {
      // append data to session.buffer
      this._session.buffer = Buffer.concat([this._session.buffer, buf]);
    }
    // discard processed bytes and move on to the next phase
    const discardProcessedBytes = (nextState: number) => {
      // this._session.buffer = this._session.buffer.slice(this._session.offset);
      this._session.buffer = this._session.buffer.subarray(
        this._session.offset
      );
      this._session.offset = 0;
      this._session.state = nextState;
    };
    switch (this._session.state) {
      case consts.STATE.METHOD_NEGOTIATION:
        const methods = this.parseMethods();
        if (methods) {
          // read complete data
          let method = this.selectMethod(methods);
          this.replyMethod(method);
          switch (method) {
            case consts.METHODS.USERNAME_PASSWD:
              discardProcessedBytes(consts.STATE.AUTHENTICATION);
              break;
            case consts.METHODS.NO_AUTH:
              discardProcessedBytes(consts.STATE.REQUEST_CONNECT);
              break;
            case consts.METHODS.NO_ACCEPTABLE:
              this._socket.end();
              break;
            default:
              this._socket.end();
          }
        }
        break;
      // curl www.baidu.com --socks5 127.0.0.1:3000 --socks5-basic --proxy-user  oiuytre:yhntgbrfvedc
      case consts.STATE.AUTHENTICATION:
        // add gssapi support
        // need check this._session.method for parse data
        let userinfo = this.parseUsernamePasswd();
        if (!!userinfo) {
          // read complete data
          let succeeded =
            userinfo.username === config.username &&
            userinfo.passwd === config.passwd;
          discardProcessedBytes(
            succeeded
              ? consts.STATE.REQUEST_CONNECT
              : consts.STATE.AUTHENTICATION
          );
          this.replyAuth(succeeded);
        }
        break;
      case consts.STATE.REQUEST_CONNECT:
        let req = this.parseRequests();
        if (req) {
          discardProcessedBytes(consts.STATE.PROXY_FORWARD);
          // read complete data
          this.dstConnect(req);
        }
        break;
      case consts.STATE.PROXY_FORWARD:
      default:
        break;
    }
  }
}
