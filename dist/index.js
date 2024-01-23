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
var import_stream2 = require("stream");

// src/utils/random.ts
var counter = 0;
function getNextCount() {
  return counter++;
}
function getNextRandomToken() {
  return getNextCount().toString(36);
}

// src/utils/frame.ts
var import_stream = require("stream");
var MetaSize = 16;
var MaxTransmitionUnitSize = 1500;
var EscapeChar = 16;
var FrameBeg = 2;
var FrameEnd = 3;
var EscapeChar_Escaped = EscapeChar ^ 255;
var FrameBeg_Escaped = FrameBeg ^ 255;
var FrameEnd_Escaped = FrameEnd ^ 255;
var SpecialChars = [EscapeChar, FrameBeg, FrameEnd];
var SpecialChars_Escaped = [EscapeChar_Escaped, FrameBeg_Escaped, FrameEnd_Escaped];
var SpecialCharRatioThreshold = 0.077;
function escapeBuffer(buffer) {
  const scp = scanBuffer(buffer);
  if (scp.length === 0)
    return buffer;
  const ratio = scp.length / buffer.length;
  let bf;
  if (ratio < SpecialCharRatioThreshold) {
    bf = escapeBufferInternal_BlockCopy(buffer, scp);
  } else {
    bf = escapeBufferInternal_ByteByByte(buffer, scp);
  }
  return bf;
}
function constructTestBuffer(size, specialCharRatio) {
  const buffer = Buffer.allocUnsafe(size);
  let specialCharCount = 0;
  for (let index = 0; index < size; index++) {
    const rnd = Math.random();
    if (rnd < specialCharRatio) {
      buffer[index] = SpecialChars[Math.floor(rnd * 3)];
      ++specialCharCount;
    } else {
      continue;
    }
  }
  return [buffer, specialCharCount / size];
}
function crc32(buffer) {
  let crc = 4294967295;
  for (let i = 0; i < buffer.length; i++) {
    crc = crc ^ buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? crc >>> 1 ^ 3988292384 : crc >>> 1;
    }
  }
  return crc ^ 4294967295;
}
function testEscapeBuffer(buffer) {
  const crc32origin = crc32(buffer);
  const t1 = Date.now();
  const scp = scanBuffer(buffer);
  const t2 = Date.now();
  const scanUsage = t2 - t1;
  const t3 = Date.now();
  const bf1 = escapeBufferInternal_BlockCopy(buffer, scp);
  const t4 = Date.now();
  const bcUsage = t4 - t3;
  const unescape1 = unescapeBuffer(bf1);
  const crc32_1 = crc32(unescape1);
  const bcCrc32Pass = crc32_1 === crc32origin ? "PASS" : "FAIL";
  const t5 = Date.now();
  const bf2 = escapeBufferInternal_ByteByByte(buffer, scp);
  const t6 = Date.now();
  const bbUsage = t6 - t5;
  const unescape2 = unescapeBuffer(bf2);
  const crc32_2 = crc32(unescape2);
  const bbCrc32Pass = crc32_2 === crc32origin ? "PASS" : "FAIL";
  console.log(" - [Scan]", scanUsage, "ms (", buffer.length, ") bytes");
  console.log(" - [Bc-Result]", bcCrc32Pass, "Usage", bcUsage, "ms (", bf1.length, ") bytes");
  console.log(" - [Bb-Result]", bbCrc32Pass, "Usage", bbUsage, "ms (", bf2.length, ") bytes");
}
function scanBuffer(buffer) {
  const specialCharPositions = [];
  let sIndex = -1;
  for (let i = 0; i < buffer.length; i++) {
    sIndex = SpecialChars.indexOf(buffer[i]);
    if (sIndex === -1)
      continue;
    specialCharPositions.push(i << 2 | sIndex);
  }
  return specialCharPositions;
}
function escapeBufferInternal_ByteByByte(buffer, specialCharPositions) {
  let estimatedSize = buffer.length + specialCharPositions.length;
  const escapedBuffer = Buffer.allocUnsafe(estimatedSize);
  let tarPos = 0;
  let byte;
  let sIndex = -1;
  for (let index = 0; index < buffer.length; index++) {
    byte = buffer[index];
    sIndex = SpecialChars.indexOf(byte);
    if (sIndex !== -1) {
      escapedBuffer[tarPos++] = EscapeChar;
      escapedBuffer[tarPos++] = SpecialChars_Escaped[sIndex];
    } else {
      escapedBuffer[tarPos++] = byte;
    }
  }
  return escapedBuffer;
}
function escapeBufferInternal_BlockCopy(buffer, specialCharPositions) {
  const escapedBufferSize = buffer.length + specialCharPositions.length;
  const escapedBuffer = Buffer.allocUnsafe(escapedBufferSize);
  let readPos = 0;
  let writePos = 0;
  let pos = 0;
  let sIndex = 0;
  for (const bitMergedPos of specialCharPositions) {
    pos = bitMergedPos >> 2;
    sIndex = bitMergedPos & 3;
    buffer.copy(escapedBuffer, writePos, readPos, pos);
    writePos += pos - readPos;
    escapedBuffer[writePos++] = EscapeChar;
    escapedBuffer[writePos++] = SpecialChars_Escaped[sIndex];
    readPos = pos + 1;
  }
  if (readPos < buffer.length) {
    buffer.copy(escapedBuffer, writePos, readPos);
  }
  return escapedBuffer;
}
function unescapeBuffer(escapedBuffer) {
  const buffer = Buffer.allocUnsafe(escapedBuffer.length);
  let tarPos = 0;
  for (let srcPos = 0; srcPos < escapedBuffer.length; srcPos++) {
    const byte = escapedBuffer[srcPos];
    if (byte === EscapeChar) {
      const nextByte = escapedBuffer[srcPos + 1];
      buffer[tarPos++] = nextByte ^ 255;
      srcPos++;
    } else {
      buffer[tarPos++] = byte;
    }
  }
  return buffer.subarray(0, tarPos);
}
function buildNullFrameObj(cid, keepAlive) {
  return {
    channelId: cid,
    id: 0,
    data: buildFrameBuffer(Buffer.allocUnsafe(0), cid),
    length: 0,
    keepAlive
  };
}
function buildFrameBuffer(chunk, cid) {
  const buffer = Buffer.allocUnsafe(chunk.length + MetaSize);
  buffer.writeBigInt64LE(BigInt(cid), 0);
  buffer.writeBigInt64LE(BigInt(chunk.length), 8);
  buffer.set(chunk, MetaSize);
  return escapeBuffer(buffer);
}
function parseFrameBuffer(frame) {
  const buffer = unescapeBuffer(frame);
  const cid = Number(buffer.readBigInt64LE(0));
  const length = Number(buffer.readBigInt64LE(8));
  const data = buffer.subarray(16, 16 + length);
  return {
    channelId: cid,
    length,
    id: 0,
    data
  };
}
function slice(data, cid) {
  const packs = [];
  let index = 0;
  let offset = 0;
  while (offset < data.length) {
    const dataSlice = data.subarray(offset, offset + MaxTransmitionUnitSize);
    const pack = {
      channelId: cid,
      id: index,
      data: buildFrameBuffer(dataSlice, cid),
      length: dataSlice.length
    };
    packs.push(pack);
    offset += MaxTransmitionUnitSize;
    ++index;
  }
  return packs;
}
var ReadFrameParser = class extends import_stream.Transform {
  buffer = Buffer.alloc(0);
  constructor() {
    super();
  }
  _transform(chunk, encoding, callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frameStartIndex = this.buffer.indexOf(FrameBeg);
      if (frameStartIndex === -1)
        break;
      const frameEndIndex = this.buffer.indexOf(FrameEnd, frameStartIndex + 1);
      if (frameEndIndex === -1)
        break;
      const frameSize = frameEndIndex - frameStartIndex - 1;
      if (frameSize < MetaSize) {
        console.error("[Transformer]", "Frame dropped: wrong size.", frameSize);
        this.buffer = this.buffer.subarray(frameStartIndex + 1);
        continue;
      }
      const frame = this.buffer.subarray(frameStartIndex + 1, frameEndIndex);
      this.push(frame);
      this.buffer = this.buffer.subarray(frameEndIndex + 1);
    }
    callback();
  }
};

// src/model/Channel.ts
var Channel = class extends import_stream2.Duplex {
  _host;
  _id;
  _streamBufferIn;
  _finished = false;
  _nullPack;
  get cid() {
    return this._id;
  }
  constructor(id, host) {
    super();
    this._host = host;
    this._id = id;
    this._streamBufferIn = [];
    this._nullPack = buildNullFrameObj(this._id, true);
    this.once("finish", () => {
      this._host.enqueueOut([this._nullPack]);
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
        console.warn("[Channel]", "EXT_DATA", buffer ? buffer.length : "[END]", "[QUEUED]");
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
    msg.tk = msg.tk || getNextRandomToken();
    let jsonMessage = JSON.stringify(msg);
    this._host.publishCtlMessage(jsonMessage);
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
          this._cbQueue.delete(m.tk);
          cb(m);
        }
      } else {
        this.dispatchCtlMessage(m);
      }
    } catch (e) {
      console.error("[Controller]", "Dispactching error:", e, msg);
    }
  }
  dispatchCtlMessage(msg) {
    switch (msg.cmd) {
      case "E" /* ESTABLISH */: {
        msg.data = this._channelManager.createChannel().cid;
        msg.flag = 1 /* CALLBACK */;
        this.sendCtlMessage(msg);
        break;
      }
      case "D" /* DISPOSE */: {
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
    host.onFrameReceived(this.dispatchFrame.bind(this));
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
    this._host.offFrameReceived(this.dispatchFrame);
    this._channels.forEach((chn) => chn?.destroy());
    this._channels.clear();
  }
  dispatchFrame(frame) {
    const { data, channelId, id } = frame;
    if (channelId === 0) {
      const message = data.toString("utf8");
      this._ctlChannel.processCtlMessageInternal(message);
      return;
    }
    const channel = this.getChannel(channelId);
    if (!channel) {
      console.warn("[ChnMan]", "Frame dropped: ", `Chn. <${channelId}> not found`);
      this.countDrop();
      return;
    }
    if (channel.destroyed) {
      console.warn("[ChnMan]", "Frame dropped: ", `Chn. <${channelId}> destroyed`);
      this.countDrop();
      return;
    }
    if (data && data.length > 0) {
      channel.pushBufferExternal(data);
    } else {
      channel.pushBufferExternal(null);
    }
    this.count();
  }
};

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
  frameEventList = /* @__PURE__ */ new Set();
  _isDestroyed = false;
  _isRunning = false;
  _isFinished = false;
  _frameBeg = Buffer.from([FrameBeg]);
  _frameEnd = Buffer.from([FrameEnd]);
  constructor(port) {
    this._physical = port;
    this._physical.on("error", console.error);
    this._physical.on("close", () => {
      console.error("[PPH]", "Physical port closed unexpectedly.");
      process.exit(1);
    });
    this._queueIncoming = [];
    this._queueOutgoing = [];
    this._parser = port.pipe(new ReadFrameParser());
    this._parser.on("data", this.onReceivedInternal.bind(this));
    console.log("[PPH]", "Port opened: ", port.path, " @ ", port.baudRate);
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
    const cid = 0;
    const buffer = Buffer.from(msg, "utf8");
    const data = buildFrameBuffer(buffer, cid);
    this._queueOutgoing.unshift({
      channelId: cid,
      id: 0,
      data,
      length: buffer.length
    });
  }
  onFrameReceived(event) {
    this.frameEventList.add(event);
  }
  offFrameReceived(event) {
    this.frameEventList.delete(event);
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
    this.frameEventList.clear();
    this._queueIncoming.length = 0;
    this._queueOutgoing.length = 0;
  }
  onReceivedInternal(data) {
    try {
      const pack = parseFrameBuffer(data);
      this._queueIncoming.push(pack);
    } catch (e) {
      console.error("[PPH]", "M_ERROR", e.message, "\n", data.toString("hex"));
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
        this._physical.write(Buffer.concat([this._frameBeg, pack.data, this._frameEnd]));
        await new Promise((res) => this._physical.drain(res));
        if (!pack.keepAlive)
          pack.data = null;
      }
    } catch (e) {
      console.error(e.message);
    }
    this._isFinished = true;
  }
  emitPackReceived(pack) {
    return new Promise((resolve) => {
      for (const cb of this.frameEventList) {
        try {
          cb(pack);
        } catch (e) {
          console.error(e);
        }
      }
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
      console.error(e.message);
    }
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
var import_serialport = require("serialport");
async function listSerialPorts() {
  return await import_serialport.SerialPort.list();
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
    const port = new import_serialport.SerialPort(
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
    case "escape": {
      for (let i = 0; i < 100; i++) {
        const [buffer, realRatio] = constructTestBuffer(MaxTransmitionUnitSize, i / 100);
        console.log(i.toString().padStart(2, "0"), "[Escape]", "RealRatio", realRatio);
        testEscapeBuffer(buffer);
      }
    }
    default:
      break;
  }
}
async function channel_test_server(portName) {
  const physicalPort = await openSerialPort(portName, 16e5);
  const host = new PhysicalPortHost(physicalPort);
  host.start();
  const chnMan = new ChannelManager(host, "svr");
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
  const chnMan = new ChannelManager(host, "client");
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
      const { data: cid, tk } = msg;
      chn = this._chnManager.createChannel(cid);
      console.log("[Channel/Socket]", "Connection established.", chn.cid);
      this._ctl.sendCtlMessage(
        {
          cmd: "C" /* CONNECT */,
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
      sock.once("close", () => this._chnManager.deleteChannel(chn));
      chn.pipe(sock);
      sock.pipe(chn);
    };
    console.log("[Channel/Socket]", "Connecting", u.href, u.port);
    this._ctl.sendCtlMessage(
      {
        cmd: "E" /* ESTABLISH */,
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
      const { data: cid, tk } = msg;
      chn = this._chnManager.createChannel(cid);
      console.log("[Channel/Request]", "Connection established.", chn.cid);
      this._ctl.sendCtlMessage(
        {
          cmd: "R" /* REQUEST */,
          tk,
          flag: 0 /* CONTROL */,
          data: { cid, opt }
        },
        null
      );
      chn.on("error", (e) => {
        console.error("ERROR", e);
        res.end();
      });
      res.on("error", (e) => {
        console.error("ERROR", e);
        chn.push(null);
      });
      res.once("close", () => {
        this._chnManager.deleteChannel(chn);
      });
      chn.pipe(res);
      req.pipe(chn);
    };
    console.log("[Channel/Request]", "Connecting", u.href, u.port);
    this._ctl.sendCtlMessage(
      {
        cmd: "E" /* ESTABLISH */,
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
  console.log(`  --serial-port, -s <path>`);
  console.log(`    Specify the serial port to connect.`);
  console.log(`    Default: . (Use the first available port)`);
  console.log(`  --baud-rate, -b <baudRate>`);
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
function redirectRequestToChn(reqInfo, chn, onClose) {
  const pReq = (0, import_https.request)(reqInfo, function(pRes) {
    pRes.pipe(chn);
    console.log("[ProxyEndPoint/Request]", "Connected", chn.cid);
  }).on("error", function(e) {
    console.log("ERROR", import_https.request, e);
    chn.push(null);
  });
  chn.pipe(pReq);
  pReq.once("close", onClose);
}
function redirectConnectToChn(reqInfo, chn, onClose) {
  const socket = (0, import_net.connect)(reqInfo, function() {
    chn.write(Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));
    socket.pipe(chn);
    chn.pipe(socket);
    console.log("[ProxyEndPoint/Socket]", "Connected", chn.cid);
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
      case "C" /* CONNECT */: {
        const { cid, opt } = msg.data;
        const channel = this._channelManager.getChannel(cid);
        console.log("[ProxyEndPoint/Socket]", "Connecting", cid, opt);
        if (channel) {
          redirectConnectToChn(opt, channel, () => {
            console.log("[ProxyEndPoint/Socket]", cid, "Channel is closing.");
            this._channelManager.deleteChannel(channel);
          });
        } else {
          console.log("[ProxyEndPoint/Socket]", cid, "Channel not found:");
        }
        break;
      }
      case "R" /* REQUEST */: {
        const { cid, opt } = msg.data;
        console.log("[ProxyEndPoint/Request]", cid, "Connecting", opt);
        const channel = this._channelManager.getChannel(cid);
        if (channel) {
          redirectRequestToChn(opt, channel, () => {
            console.log("[ProxyEndPoint/Request]", cid, "Channel is closing.");
            this._channelManager.deleteChannel(channel);
          });
          channel.once("finish", () => this._channelManager.deleteChannel(channel));
        } else {
          console.log("[ProxyEndPoint/Request]", cid, "Channel not found:");
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
