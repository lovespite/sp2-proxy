var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/model/Channel.ts
var import_stream = require("stream");

// src/model/DataPack.ts
function getNullPack(cid) {
  return {
    cid,
    id: 0,
    data: null
  };
}
function slice(data, cid, maxPackSize = 1024) {
  const packs = [];
  let index = 0;
  let offset = 0;
  while (offset < data.length) {
    const pack = {
      cid,
      id: index,
      data: data.subarray(offset, offset + maxPackSize).toString("base64")
    };
    packs.push(pack);
    offset += maxPackSize;
    ++index;
  }
  return packs;
}

// src/utils/random.ts
function getNextRandomToken() {
  return Math.random().toString(36).substring(2).padStart(12, "0");
}

// src/model/Channel.ts
var Channel = class extends import_stream.Duplex {
  _host;
  _id;
  _streamBufferIn;
  _finished = false;
  get cid() {
    return this._id;
  }
  constructor(id, host) {
    super();
    this._host = host;
    this._id = id;
    this._streamBufferIn = [];
    this.once("finish", () => {
      this._host.enqueueOut([getNullPack(this._id)]);
    });
  }
  _write(chunk, encoding, callback) {
    let packs;
    if (chunk instanceof Buffer) {
      packs = slice(chunk, this._id);
    } else {
      packs = slice(Buffer.from(chunk, encoding), this._id);
    }
    this._host.enqueueOut(packs);
    callback();
  }
  _read(size) {
    const data = this._streamBufferIn.shift();
    if (!data) {
      if (this._finished) {
        this.push(null);
      } else {
        return;
      }
    } else {
      this.push(data);
    }
  }
  pushBufferExternal(buffer) {
    if (buffer === null) {
      this._finished = true;
    } else {
      if (this._streamBufferIn.length === 0) {
        this.push(buffer);
      } else {
        this._streamBufferIn.push(buffer);
        console.log("C_DATA", buffer.length, "[QUEUE]");
      }
    }
  }
  _destroy(error, callback) {
    this.push(null);
    this._streamBufferIn.length = 0;
    callback();
  }
};
var ControllerChannel = class extends Channel {
  _cbQueue = /* @__PURE__ */ new Map();
  _ctlMsgHandlers = /* @__PURE__ */ new Set();
  _channelManager;
  constructor(host, man) {
    super(0, host);
    this._channelManager = man;
  }
  onCtlMessageReceived(cb) {
    this._ctlMsgHandlers.add(cb);
  }
  offCtlMessageReceived(cb) {
    this._ctlMsgHandlers.delete(cb);
  }
  invokeCtlMessageHandlers(m) {
    const sb = this.sendCtlMessage.bind(this);
    for (const cb of this._ctlMsgHandlers)
      cb(m, sb);
  }
  sendCtlMessage(msg, cb) {
    if (this.cid !== 0)
      throw new Error("Only controller channel can send control message.");
    msg.tk = msg.tk || getNextRandomToken();
    let jsonMessage = JSON.stringify(msg);
    this._host.publishCtlMessage(jsonMessage);
    console.log("\u53D1\u9001\u63A7\u5236\u6D88\u606F", msg, cb ? "[CALLBACK]" : "[NO-CALLBACK]");
    if (cb)
      this._cbQueue.set(msg.tk, cb);
  }
  processCtlMessageInternal(msg) {
    try {
      const m = JSON.parse(msg);
      if (!m.tk)
        return;
      if (m.flag === 1 /* CALLBACK */) {
        const cb = this._cbQueue.get(m.tk);
        if (cb) {
          console.log("\u6D88\u606F\u5904\u7406-\u56DE\u8C03", m);
          this._cbQueue.delete(m.tk);
          cb(m);
        }
      } else {
        try {
          console.log("\u6D88\u606F\u5904\u7406-\u63A7\u5236", m);
          this.dispatchCtlMessage(m);
        } catch (e) {
          console.log("\u6D88\u606F\u5904\u7406-\u63A7\u5236-\u9519\u8BEF", e, msg);
        }
      }
    } catch (e) {
      console.log("\u6D88\u606F\u5904\u7406-\u9519\u8BEF", e, msg);
    }
  }
  dispatchCtlMessage(msg) {
    switch (msg.cmd) {
      case "ESTABLISH": {
        msg.data = this._channelManager.createChannel().cid;
        msg.flag = 1 /* CALLBACK */;
        console.log(this._channelManager.name, "\u6D88\u606F\u5206\u53D1-\u5EFA\u7ACB\u96A7\u9053", msg, this._channelManager.getChannelCount());
        this.sendCtlMessage(msg);
        break;
      }
      case "DISPOSE": {
        console.log("\u6D88\u606F\u5206\u53D1-\u5173\u95ED\u96A7\u9053", msg);
        this._channelManager.deleteChannel(msg.data);
        break;
      }
      default:
        this.invokeCtlMessageHandlers(msg);
        break;
    }
  }
};

// src/model/ChannelManager.ts
var ChannelManager = class {
  _cid = 1;
  getNextCid() {
    return this._cid++;
  }
  _ctlChannel;
  _packCount = 0;
  _droppedCount = 0;
  count() {
    ++this._packCount;
  }
  countDrop() {
    ++this._droppedCount;
  }
  get packCount() {
    return this._packCount;
  }
  get droppedCount() {
    return this._droppedCount;
  }
  get ctlChannel() {
    return this._ctlChannel;
  }
  _channels = /* @__PURE__ */ new Map();
  _chnManName;
  get name() {
    return this._chnManName;
  }
  toString() {
    return this.name;
  }
  constructor(host, name) {
    this._host = host;
    this._chnManName = name;
    host.onPackReceived(this.dispatchPack.bind(this));
    this._ctlChannel = new ControllerChannel(this._host, this);
  }
  getChannel(id) {
    return this._channels.get(id);
  }
  getChannelCount() {
    return this._channels.size;
  }
  getChannels() {
    return [...this._channels.values()];
  }
  getChannelIds() {
    return [...this._channels.keys()];
  }
  createChannel(id) {
    const cid = id || this.getNextCid();
    const channel = new Channel(cid, this._host);
    this._channels.set(cid, channel);
    return channel;
  }
  deleteChannel(chn) {
    this._channels.delete(chn.cid);
  }
  _host;
  async destroy() {
    this._host.destroy();
    this._host.offPackReceived(this.dispatchPack);
    this._channels.forEach((chn) => chn?.destroy());
    this._channels.clear();
  }
  dispatchPack(pack) {
    if (pack.cid === 0) {
      const message = Buffer.from(pack.data, "base64").toString("utf8");
      console.log("\u6536\u5230\u63A7\u5236\u6D88\u606F", message);
      this._ctlChannel.processCtlMessageInternal(message);
      return;
    }
    const channel = this.getChannel(pack.cid);
    if (!channel) {
      console.log("DROP", pack.id, `Chn. <${pack.cid}> not found`);
      this.countDrop();
      return;
    }
    if (channel.destroyed) {
      console.log("DROP", pack.id, `Chn. <${pack.cid}> destroyed`);
      this.countDrop();
      return;
    }
    if (pack.data) {
      channel.pushBufferExternal(Buffer.from(pack.data, "base64"));
    } else {
      channel.pushBufferExternal(null);
    }
    this.count();
  }
};

// src/model/PhysicalPortHost.ts
var import_serialport = require("serialport");

// src/utils/delay.ts
async function delay(msTimeOut) {
  return new Promise((resolve) => setTimeout(resolve, msTimeOut));
}

// src/model/PhysicalPortHost.ts
var PhysicalPortHost = class {
  _queueIncoming;
  _queueOutgoing;
  _physical;
  _parser;
  packEventList = /* @__PURE__ */ new Set();
  _isDestroyed = false;
  _isRunning = false;
  _isFinished = false;
  constructor(port) {
    this._physical = port;
    this._physical.on("error", console.error);
    this._physical.on("close", () => console.log("CLOSED"));
    this._queueIncoming = [];
    this._queueOutgoing = [];
    this._parser = port.pipe(new import_serialport.ReadlineParser({ delimiter: "\r\n" }));
    this._parser.on("data", this.onReceivedInternal.bind(this));
    console.log("Port opened.");
  }
  async waitForFinish() {
    while (!this._isFinished) {
      await delay(100);
    }
  }
  enqueueOut(packs) {
    if (this._isDestroyed || !this._isRunning) {
      throw new Error("Port is not running.");
    }
    this._queueOutgoing.push(...packs);
  }
  publishCtlMessage(msg) {
    if (this._isDestroyed || !this._isRunning) {
      throw new Error("Port is not running.");
    }
    this._queueOutgoing.unshift({
      cid: 0,
      id: 0,
      data: Buffer.from(msg, "utf8").toString("base64")
    });
  }
  onPackReceived(event) {
    this.packEventList.add(event);
  }
  offPackReceived(event) {
    this.packEventList.delete(event);
  }
  async start() {
    if (this._isDestroyed) {
      throw new Error("Port is destroyed.");
    }
    if (this._isRunning) {
      throw new Error("Port is already running.");
    }
    this._isRunning = true;
    await Promise.all([this.startSendingDequeueTask(), this.startReceivingDequeueTask()]);
  }
  async stop() {
    this._isRunning = false;
    await this.waitForFinish();
  }
  async destroy() {
    this._isDestroyed = true;
    await this.stop();
    if (this._physical.isOpen)
      this._physical.close();
    this._parser.destroy();
    this.packEventList.clear();
    this._queueIncoming.length = 0;
    this._queueOutgoing.length = 0;
  }
  onReceivedInternal(data) {
    try {
      const pack = JSON.parse(data);
      if (pack.cid === void 0)
        return;
      this._queueIncoming.push(pack);
    } catch (e) {
      console.log("M_ERROR", e.message, data);
    }
  }
  async startSendingDequeueTask() {
    try {
      while (true) {
        if (!this._isRunning && this._queueOutgoing.length === 0)
          break;
        const pack = await this.blockDequeueOut();
        if (!pack)
          continue;
        if (!this._physical)
          break;
        const json = JSON.stringify(pack);
        this._physical.write(json + "\r\n");
        await new Promise((res) => this._physical.drain(res));
      }
    } catch (e) {
      console.log(e.message);
    }
    this._isFinished = true;
    console.log("SENDING STOPPED");
  }
  emitPackReceived(pack) {
    return new Promise((resolve) => {
      this.packEventList.forEach((event) => {
        try {
          event(pack);
        } catch (e) {
          console.error(e);
        }
      });
      resolve();
    });
  }
  async startReceivingDequeueTask() {
    try {
      while (this._isRunning) {
        const pack = await this.blockDequeueIn();
        this.emitPackReceived(pack);
      }
    } catch (e) {
      console.log(e.message);
    }
    console.log("RECEIVING STOPPED");
  }
  async blockDequeueIn() {
    while (this._queueIncoming.length === 0) {
      await delay(100);
      if (!this._isRunning)
        throw new Error("Port stopped.");
    }
    return this._queueIncoming.shift();
  }
  async blockDequeueOut() {
    while (this._queueOutgoing.length === 0) {
      await delay(100);
      if (!this._isRunning)
        return;
    }
    return this._queueOutgoing.shift();
  }
};

// src/utils/serialportHelp.ts
var import_serialport2 = require("serialport");
async function listSerialPorts() {
  return await import_serialport2.SerialPort.list();
}
async function openSerialPort(portName, baudRate) {
  if (portName.startsWith(".")) {
    const list = await listSerialPorts();
    const index = portName.length - 1;
    if (list.length <= index) {
      throw new Error(`No serial port available at index ${index}`);
    }
    portName = list[index].path;
  }
  if (!baudRate)
    baudRate = 16e5;
  return new Promise((resolve, reject) => {
    const port = new import_serialport2.SerialPort(
      {
        path: portName,
        baudRate,
        autoOpen: true,
        stopBits: 1,
        parity: "none",
        dataBits: 8
      },
      (err) => {
        if (err)
          reject(err);
        else
          resolve(port);
      }
    );
  });
}

// test.ts
var fs = __toESM(require("fs"));
async function test(args2) {
  const test_cmd = args2[0][0];
  console.log(args2);
  switch (test_cmd) {
    case "channel_s":
      await channel_test_server(args2[1][0]);
      break;
    case "channel_c":
      await channel_test_client(args2[1][0], args2[2][0]);
      break;
    default:
      break;
  }
}
async function channel_test_server(portName) {
  const physicalPort = await openSerialPort(portName, 16e5);
  const host = new PhysicalPortHost(physicalPort);
  host.start();
  const chnMan = new ChannelManager(host);
  const chn1 = chnMan.createChannel();
  const fileStream = fs.createWriteStream("test.txt");
  chn1.pipe(fileStream);
  await new Promise((res) => chn1.once("end", res));
  console.log("File finished.");
  fileStream.close();
  await chnMan.destroy();
}
async function channel_test_client(portName, file) {
  const physicalPort = await openSerialPort(portName, 16e5);
  const host = new PhysicalPortHost(physicalPort);
  host.start();
  const chnMan = new ChannelManager(host);
  const chn1 = chnMan.createChannel();
  const fileStream = fs.createReadStream(file);
  console.log("Streaming...");
  fileStream.pipe(chn1);
  await new Promise((res) => {
    chn1.on("finish", res);
  });
  chn1.destroy();
  console.log("Done.");
  fileStream.close();
  await chnMan.destroy();
}

// src/service/host.ts
var import_http = require("http");
var ProxyServer = class {
  _options;
  _host;
  _chnManager;
  _ctl;
  constructor(options) {
    this._options = options;
    this._host = new PhysicalPortHost(this._options.serialPort);
    this._chnManager = new ChannelManager(this._host, "ProxyServer");
    this._ctl = this._chnManager.ctlChannel;
  }
  connect(req, sock) {
    const u = new URL("http://" + req.url);
    let chn;
    const opt = {
      port: parseInt(u.port) || 80,
      host: u.hostname
    };
    const onEstablished = (msg) => {
      console.log("\u4EE3\u7406\u670D\u52A1\u5668-\u6536\u5230\u8BF7\u6C42\u53CD\u9988\uFF1A", msg);
      const { data: cid, tk } = msg;
      chn = this._chnManager.createChannel(cid);
      console.log("\u4EE3\u7406\u670D\u52A1\u5668-\u96A7\u9053\u5EFA\u7ACB\u6210\u529F\uFF0C \u5C1D\u8BD5\u5EFA\u7ACBSocket\u94FE\u63A5", chn.cid);
      this._ctl.sendCtlMessage(
        {
          cmd: "CONNECT",
          tk,
          flag: 0 /* CONTROL */,
          data: { cid, opt }
        },
        null
      );
      chn.on("error", (e) => {
        console.log("ERROR", e);
        sock.push(null);
      });
      sock.on("error", (e) => {
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
    console.log("\u4EE3\u7406\u670D\u52A1\u5668-\u5C1D\u8BD5\u5EFA\u7ACB\u96A7\u9053...");
    this._ctl.sendCtlMessage(
      {
        cmd: "ESTABLISH",
        tk: null,
        flag: 0 /* CONTROL */
      },
      onEstablished
    );
  }
  request(req, res) {
    const u = new URL(req.url);
    let chn;
    const opt = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: req.method,
      headers: req.headers
    };
    const onEstablished = (msg) => {
      console.log("\u4EE3\u7406\u670D\u52A1\u5668-\u6536\u5230\u8BF7\u6C42\u53CD\u9988\uFF1A", msg);
      const { data: cid, tk } = msg;
      chn = this._chnManager.createChannel(cid);
      console.log("\u4EE3\u7406\u670D\u52A1\u5668-\u96A7\u9053\u5EFA\u7ACB\u6210\u529F\uFF0C \u5C1D\u8BD5\u5EFA\u7ACB\u8BF7\u6C42", chn.cid);
      this._ctl.sendCtlMessage(
        {
          cmd: "REQUEST",
          tk,
          flag: 0 /* CONTROL */,
          data: { cid, opt }
        },
        null
      );
      chn.on("error", (e) => {
        console.log("ERROR", e);
        res.end();
      });
      res.on("error", (e) => {
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
    console.log("\u4EE3\u7406\u670D\u52A1\u5668-\u5C1D\u8BD5\u5EFA\u7ACB\u96A7\u9053...");
    this._ctl.sendCtlMessage(
      {
        cmd: "ESTABLISH",
        tk: null,
        flag: 0 /* CONTROL */
      },
      onEstablished
    );
  }
  listen() {
    this._host.start();
    (0, import_http.createServer)().on("request", this.request.bind(this)).on("connect", this.connect.bind(this)).listen(this._options.port || 13808, this._options.listen || "0.0.0.0");
  }
};

// src/utils/help.ts
function printUsage() {
  console.log(`Usage: node ${process.argv[1]} <command> [options]`);
  console.log("General options:");
  console.log(`  --serialPort, -s <path>`);
  console.log(`    Specify the serial port to connect.`);
  console.log(`    Default: . (Use the first available port)`);
  console.log(`  --baudRate, -b <baudRate>`);
  console.log(`    Specify the baud rate.`);
  console.log(`    Default: 1600000`);
  console.log(``);
  console.log(`Commands:`);
  console.log(`  list`);
  console.log(`    List all available serial ports.`);
  console.log(`  proxy [options]`);
  console.log(`    Start the intermedia proxy server.`);
  console.log(`    Options:`);
  console.log(`      --listen, -l <ip>`);
  console.log(`        Specify the IP address to listen.`);
  console.log(`        Default: 0.0.0.0`);
  console.log(`      --port, -p <port>`);
  console.log(`        Specify the port to listen.`);
  console.log(`        Default: 13808`);
  console.log(`  host [options]`);
  console.log(`    Start the host proxy server, where the real traffic outlets.`);
}

// src/utils/options.ts
var map = /* @__PURE__ */ new Map();
var args = [];
var command;
function parse(str) {
  command = str[0];
  str.slice(1).forEach((s) => {
    let [name, value] = s.split("=").map((x) => x.trim());
    while (name.startsWith("-")) {
      name = name.slice(1);
    }
    if (!name)
      return;
    map.set(name, value);
    args.push([name, value]);
  });
}
function getArgs() {
  return Array.from(args);
}
function getCommand() {
  return command;
}
function getOption(name, alias, defaultValue) {
  return map.get(name) || map.get(alias) || defaultValue;
}

// src/service/request.ts
var import_https = require("https");
var import_net = require("net");
function redirectRequestToChn(reqInfo, chn) {
  const pReq = (0, import_https.request)(reqInfo, function(pRes) {
    pRes.pipe(chn);
  }).on("error", function(e) {
    console.log("ERROR", import_https.request, e);
    chn.push(null);
  });
  chn.pipe(pReq);
}
function redirectConnectToChn(reqInfo, chn, onClose) {
  const socket = (0, import_net.connect)(reqInfo, function() {
    console.log("\u4EE3\u7406\u7AEF\u70B9-Socket\u94FE\u63A5\u5DF2\u5EFA\u7ACB", reqInfo);
    chn.write(Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));
    socket.pipe(chn);
    chn.pipe(socket);
  }).on("error", function(e) {
    console.log("ERROR", reqInfo, e);
    chn.push(null);
  });
  socket.once("close", onClose);
}

// src/service/proxy.ts
var ProxyEndPoint = class {
  _options;
  _host;
  _channelManager;
  constructor(options) {
    this._options = options;
    this._host = new PhysicalPortHost(this._options.serialPort);
    this._channelManager = new ChannelManager(this._host, "ProxyEndPoint");
  }
  onCtlMessageReceived(msg) {
    switch (msg.cmd) {
      case "REQUEST": {
        const { cid, opt } = msg.data;
        console.log(this._channelManager.name, "\u4EE3\u7406\u7AEF\u70B9-\u63A5\u6536\u63A7\u5236\u6D88\u606F-REQUEST", cid, opt);
        const channel = this._channelManager.getChannel(cid);
        if (channel) {
          redirectRequestToChn(opt, channel);
          channel.once("finish", () => this._channelManager.deleteChannel(channel));
        }
        break;
      }
      case "CONNECT": {
        const { cid, opt } = msg.data;
        const channel = this._channelManager.getChannel(cid);
        console.log("\u4EE3\u7406\u7AEF\u70B9-\u63A5\u6536\u63A7\u5236\u6D88\u606F-CONNECT", cid, opt);
        if (channel) {
          redirectConnectToChn(opt, channel, () => {
            console.log("\u4EE3\u7406\u7AEF\u70B9-\u7BA1\u9053\u5173\u95ED-\u96A7\u9053\u5373\u5C06\u5173\u95ED", cid);
            this._channelManager.deleteChannel(channel);
          });
        } else {
          console.log("\u4EE3\u7406\u7AEF\u70B9-\u63A5\u6536\u63A7\u5236\u6D88\u606F-CONNECT", "\u4FE1\u9053\u4E0D\u5B58\u5728", cid);
        }
        break;
      }
    }
  }
  async proxy() {
    const ctl = this._channelManager.ctlChannel;
    ctl.onCtlMessageReceived(this.onCtlMessageReceived.bind(this));
    await this._host.start();
  }
};

// src/index.ts
async function main() {
  parse(process.argv.slice(2));
  const serialPortName = getOption("serial-port", "s", ".");
  const baudRate = parseInt(getOption("baud-rate", "b", "1600000"));
  let serialPort;
  let opts;
  const cmd = getCommand();
  if (!cmd) {
    printUsage();
  }
  switch (cmd) {
    case "list":
      listSerialPorts().then((list) => {
        console.log(`Available serial ports:`);
        list.forEach((p, i) => {
          console.log(`[${i + 1}]  ${p.path}`);
          console.log(`      Manu.:${p.manufacturer} Vend.:${p.vendorId} Prod.:${p.productId}`);
          console.log("");
        });
      }).catch((err) => console.error(err));
      break;
    case "proxy":
      serialPort = await openSerialPort(serialPortName, baudRate);
      opts = { serialPort };
      await new ProxyEndPoint(opts).proxy();
      break;
    case "host":
      serialPort = await openSerialPort(serialPortName, baudRate);
      opts = {
        serialPort,
        port: parseInt(getOption("port", "p", "13808")),
        listen: getOption("listen", "l", "0.0.0.0")
      };
      new ProxyServer(opts).listen();
      break;
    case "test":
      await test(getArgs());
      break;
    default:
      printUsage();
  }
}
main();
