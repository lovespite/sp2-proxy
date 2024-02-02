import { ReadlineParser, SerialPort } from "serialport";
import { PhysicalPort } from "../model/PhysicalPort";
import express, { Response, Request } from "express";
import * as ws from "socket.io";
import { createServer } from "http";
import { ChannelManager } from "../model/ChannelManager";
import { BlockQueue, QueueTimeoutError } from "../model/BlockQueue";
import * as response from "../utils/success";
import { Channel } from "../model/Channel";
import getNextRandomToken from "../utils/random";
import * as fs from "fs";
import crypto from "crypto";

import {
  ControlMessage,
  CtlMessageCommand,
  CtlMessageFlag,
  CtlMessageSendBackDelegate,
} from "../model/ControllerChannel";
import { exec } from "child_process";

const version = "0.0.1";
const root = __dirname;
const static_root = root + "\\app\\static";

enum MessageContentType {
  Text = 0,
  File = 1,
  Image = 2,
}

type Message = {
  type: MessageContentType;
  content: string;
  mineType: string;
  fileName?: string;
};

type MessageChannel = {
  token: string;
  channel: Channel;
  queue: BlockQueue<Message>;
  socket?: ws.Socket;
};

enum ExMessageCmd {
  GET_CHANNELS = "&00",
  SHELL = "&01",
  FILE = "&02",
  IMAGE = "&03",
}

export class Messenger {
  private readonly _host: PhysicalPort;
  private readonly _channelManager: ChannelManager;

  private readonly _tokenMap: Map<number, MessageChannel> = new Map();

  public constructor(sp: SerialPort) {
    this._host = new PhysicalPort(sp);
    this._channelManager = new ChannelManager(this._host, "messenger");

    this._channelManager.ctlChannel.onCtlMessageReceived(
      this.handleControlMessage.bind(this)
    );
  }

  private async getRemoteChannels() {
    const msg: ControlMessage = {
      tk: null,
      cmd: ExMessageCmd.GET_CHANNELS,
      flag: CtlMessageFlag.CONTROL,
    };

    return new Promise<number[]>((resolve, reject) => {
      const timeOut = setTimeout(() => {
        reject(new Error("timeout"));
      }, 10_000); // 10s

      this._channelManager.ctlChannel.sendCtlMessage(msg, (m) => {
        clearTimeout(timeOut);
        resolve(m.data);
      });
    });
  }

  private handleControlMessage(
    msg: ControlMessage,
    sb: CtlMessageSendBackDelegate
  ) {
    switch (msg.cmd) {
      case ExMessageCmd.GET_CHANNELS: {
        const ids = this._channelManager.getChannelIds();
        msg.flag = CtlMessageFlag.CALLBACK;
        msg.data = ids;
        sb(msg);
        break;
      }

      case ExMessageCmd.SHELL: {
        const cmd = msg.data;

        const proc = exec(cmd, (error, stdout, stderr) => {
          msg.flag = CtlMessageFlag.CALLBACK;
          if (error) {
            msg.data = {
              success: false,
              finished: true,
              message: error.message,
              stderr,
              stdout,
            };
            delete msg.keepAlive; // close the communication socket
            sb(msg);
          } else {
            msg.data = {
              success: true,
              finished: false,
              stderr,
              stdout,
            };
            msg.keepAlive = true; // keep the communication socket
            sb(msg);
          }
        });

        proc.stdout.on("data", (data) => {
          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = {
            finished: false,
            stdout: data,
          };
          msg.keepAlive = true;
          sb(msg);
        });

        proc.stderr.on("data", (data) => {
          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = {
            finished: false,
            stderr: data,
          };
          msg.keepAlive = true;
          sb(msg);
        });

        proc.on("close", (code) => {
          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = {
            finished: true,
            code,
          };
          delete msg.keepAlive; // close the communication socket
          sb(msg);
        });

        break;
      }

      case ExMessageCmd.IMAGE:
      case ExMessageCmd.FILE: {
        console.log("file request", msg);

        const { name, cid, sha1 } = msg.data as {
          name: string;
          cid: number;
          sha1: string;
        };
        const msgChannel = this._tokenMap.get(cid);

        if (!msgChannel) {
          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = null;
          sb(msg);
          return;
        }

        const ext = "." + name.split(".").pop() || "bin";

        const fileName = `${randomToken()}${ext}`;

        const uri = `/files/${fileName}`;
        const path = `${static_root}\\files\\${fileName}`;

        const writable = fs.createWriteStream(path);
        const fChannel = this._channelManager.createChannel();
        fChannel.pipe(writable);

        msg.flag = CtlMessageFlag.CALLBACK;
        msg.data = fChannel.cid;

        fChannel.once("end", () => {
          writable.close();
          this._channelManager.deleteChannel(fChannel);

          const sha1Promise = calcFileSha1(path);

          sha1Promise.then((fileSha1) => {
            if (fileSha1 !== sha1) {
              fs.rm(path, (e) => console.error(e));

              msgChannel.queue.enqueue({
                type: MessageContentType.Text,
                content: "[文件/图片传输失败：文件校验失败]",
                mineType: "text/plain",
              });
            } else {
              msgChannel.queue.enqueue({
                type:
                  msg.cmd === ExMessageCmd.IMAGE
                    ? MessageContentType.Image
                    : MessageContentType.File,
                content: uri,
                fileName: name, // original file name
                mineType: "application/octet-stream",
              });
            }
          });
        });

        sb(msg);
        break;
      }
    }
  }

  public start({ port, listen }: { port: number; listen: string }) {
    const app = express();
    const server = createServer(app);
    const wsio = new ws.Server(server);

    wsio.on("connection", this.onConnection.bind(this));

    app.use("/api", express.json({ limit: "100kb" }));
    app.use(
      "/raw",
      express.raw({ type: "application/octet-stream", limit: "50mb" })
    );

    app.get("/info", this.getInfo.bind(this));
    app.get("/api/channels", this.getChannels.bind(this));
    app.post("/api/channel", this.openChannel.bind(this));
    app.delete("/api/channel/:cid", this.closeChannel.bind(this));
    app.post("/api/message", this.postTextMessage.bind(this));
    app.get("/api/message/:cid", this.pullMessage.bind(this));

    app.post("/raw/image/:cid", this.postImage.bind(this));
    app.post("/raw/file/:cid", this.postFile.bind(this));

    app.use(express.static(static_root));

    server.listen(port, listen, () => {
      console.log(`Working on http://${listen}:${port}`);
    });

    this._host.start();
  }

  // ============== websocket handlers =========

  private async onConnection(socket: ws.Socket) {
    const { cid, token } = socket.handshake.query as {
      cid: string;
      token: string;
    };

    if (!cid || !token) {
      console.error("missing cid or token");
      socket.disconnect();
      return;
    }

    console.log(socket.id, "connecting", cid, token);
    const ret = await this.connectSocketToChannel(socket, parseInt(cid), token);

    if (!ret.success) {
      console.log(socket.id, "connected", ret);
      socket.emit("error", ret);

      setTimeout(() => {
        socket.disconnect();
      }, 3000);
      return;
    } else {
      console.log(socket.id, "connected", ret);
    }

    socket.on("rpc", this.rpc.bind(this, socket));
  }

  private rpc(socket: ws.Socket, cmd: string, ticket: string, data: any) {
    switch (cmd) {
      case "send": {
        const ret = this.onMessage(data);
        socket.emit("rpc", ticket, ret);
        break;
      }
      default:
        socket.emit("rpc", ticket, {
          success: false,
          message: "unknown command",
        });
        break;
    }
  }

  private async connectSocketToChannel(
    socket: ws.Socket,
    cid: number,
    token: string
  ) {
    const msgChn = this._tokenMap.get(cid);

    if (!msgChn) {
      return { success: false, message: "channel not found" };
    }

    if (msgChn.token !== token) {
      return { success: false, message: "unauthorized" };
    }

    if (msgChn.socket) {
      return { success: false, message: "access denied" };
    }

    msgChn.socket = socket;
    msgChn.queue.onItemQueued = (item) => {
      socket.emit("data", item);
      return false; // no need to keep the item in the queue
    };

    socket.once("disconnect", () => {
      try {
        this.close(msgChn);
        console.log(`channel ${cid} closed: client disconnect.`);
      } catch (e) {
        console.error(e);
      }
    });

    return { success: true, message: "ok" };
  }

  private onMessage({
    msg,
    token,
    cid,
  }: {
    token: string;
    cid: number;
    msg: Message;
  }) {
    const msgChn = this._tokenMap.get(cid);
    if (msgChn && msgChn.token === token) {
      msgChn.channel.write(Buffer.from(JSON.stringify(msg) + "\r\n", "utf8"));

      return { success: true, message: "ok" };
    } else {
      return { success: false, message: "access denied" };
    }
  }

  // ============== http handlers ==============

  private async getInfo(req: Request, res: Response) {
    res
      .type("html")
      .send(infoHtml(version, this._host.path, this._host.baudRate));
  }

  /**
   * get /api/channels
   * @param req
   * @param res
   */
  private async getChannels(req: Request, res: Response) {
    try {
      const ids = await this.getRemoteChannels();
      response.success(res, ids);
    } catch (e) {
      response.fail(res, e.message || "unknown error");
    }
  }

  /**
   * post /api/channel -> { token: "xxx", cid: 1 }
   * @param req
   * @param res
   */
  private async openChannel(req: Request, res: Response) {
    //
    try {
      const { cid } = req.body as { cid: number | undefined };

      if (cid && this._tokenMap.has(cid)) {
        response.fail(res, "channel already exists");
        return;
      }

      const channel = this._channelManager.createChannel(cid);

      const queue = new BlockQueue<Message>(10000);
      const token = getNextRandomToken().padStart(6, "a");

      channel.once("close", () => {
        this._tokenMap.delete(channel.cid);
        this._channelManager.deleteChannel(channel);
      });

      const parser = channel.pipe(new ReadlineParser());
      parser.on("data", (line: string) => {
        try {
          queue.enqueue(JSON.parse(line));
        } catch (error) {
          queue.enqueue({
            type: MessageContentType.Text,
            content: line,
            mineType: "text/plain",
          });
        }
      });

      this._tokenMap.set(channel.cid, { token, channel, queue });

      response.success(res, { token, cid: channel.cid });
    } catch (e) {
      response.internalError(res, e.message);
    }
  }

  /**
   * delete /api/channel/@cid?token=xxx
   * @param req
   * @param res
   * @returns
   */
  private async closeChannel(req: Request, res: Response) {
    const { token } = req.query as { token: string };
    const { cid } = req.params as { cid: string };

    if (!token) {
      response.badRequest(res, "missing token");
      return;
    }

    const channelId = parseInt(cid);
    if (isNaN(channelId)) {
      response.badRequest(res, "invalid channel id");
      return;
    }

    const channel = this._tokenMap.get(channelId);
    if (!channel) {
      response.notFound(res);
      return;
    }

    if (channel.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      this.close(channel);
      response.success(res, "ok");
    } catch (e) {
      response.internalError(res, e.message);
    }
  }

  /**
   * post /api/message -> { token: "xxx", cid: 1, type: 0, content: "hello" }
   * @param req
   * @param res
   * @returns
   */
  private async postTextMessage(req: Request, res: Response) {
    const { token, cid, content } = req.body as {
      token: string;
      cid: number;
      content: string;
    };

    if (!token) {
      response.badRequest(res, "missing token");
      return;
    }

    if (isNaN(cid)) {
      response.badRequest(res, "invalid channel id");
      return;
    }

    if (!content) {
      response.badRequest(res, "missing content");
      return;
    }

    const { channel, token: cToken } = this._tokenMap.get(cid);

    if (!channel) {
      response.notFound(res);
      return;
    }

    if (cToken !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      const msg: Message = {
        type: MessageContentType.Text,
        content: content,
        mineType: "text/plain",
      };
      const buffer = Buffer.from(JSON.stringify(msg) + "\r\n", "utf8");
      channel.write(buffer);
      response.success(res, "ok");
    } catch (e) {
      response.internalError(res, e.message);
    }
  }

  /**
   * post /raw/image/:cid?token=xxx&name=xxx
   * @param req
   * @param res
   * @returns
   */
  private async postImage(req: Request, res: Response) {
    const { cid } = req.params as { cid: string };
    const { token, name } = req.query as { token: string; name: string };
    const buffer = req.body as Buffer;

    if (!name) {
      response.badRequest(res, "missing name");
      return;
    }

    if (!token) {
      response.badRequest(res, "missing token");
      return;
    }

    const channelId = parseInt(cid);
    if (isNaN(channelId)) {
      response.badRequest(res, "invalid channel id");
      return;
    }

    const msgChannel = this._tokenMap.get(channelId);

    if (!msgChannel) {
      response.notFound(res);
      return;
    }

    if (msgChannel.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      await this.sendingBuffer(ExMessageCmd.IMAGE, name, channelId, buffer);

      response.success(res, "ok");
    } catch (e) {
      response.internalError(res, e.message);
    }
  }

  /**
   * post /raw/file/:cid?token=xxx&name=xxx
   * @param req
   * @param res
   */
  private async postFile(req: Request, res: Response) {
    const { cid } = req.params as { cid: string };
    const { token, name } = req.query as { token: string; name: string };
    const buffer = req.body as Buffer;

    if (!name) {
      response.badRequest(res, "missing name");
      return;
    }

    if (!token) {
      response.badRequest(res, "missing token");
      return;
    }

    const channelId = parseInt(cid);
    if (isNaN(channelId)) {
      response.badRequest(res, "invalid channel id");
      return;
    }

    const msgChannel = this._tokenMap.get(channelId);

    if (!msgChannel) {
      response.notFound(res);
      return;
    }

    if (msgChannel.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      await this.sendingBuffer(ExMessageCmd.FILE, name, channelId, buffer);

      response.success(res, "ok");
    } catch (e) {
      response.internalError(res, e.message);
    }
  }

  private async sendingBuffer(
    cmd: ExMessageCmd,
    name: string,
    channelId: number,
    buffer: Buffer
  ) {
    const sha1 = await calcBufferSha1(buffer);
    return new Promise<void>((resolve, reject) => {
      this._channelManager.ctlChannel.sendCtlMessage(
        {
          tk: getNextRandomToken(),
          flag: CtlMessageFlag.CONTROL,
          cmd,
          data: {
            name: decodeURIComponent(name),
            cid: channelId,
            sha1,
          },
        },
        (m) => {
          if (!m.data) {
            return reject(new Error("cannot establish communication"));
          }
          console.log("file channel established", m.data);

          const cid = m.data as number;
          const fChannel = this._channelManager.createChannel(cid);

          fChannel.write(buffer, () => {
            console.log("file sent");
            fChannel.finish();
            fChannel.end();
            resolve();
            this._channelManager.deleteChannel(fChannel);
          });
        }
      );
    });
  }

  /**
   * get /api/message/@cid?token=xxx&timeout=15000
   * @param req
   * @param res
   * @returns
   */
  private async pullMessage(req: Request, res: Response) {
    const { token, timeout } = req.query as { token: string; timeout: string };
    const { cid } = req.params as { cid: string };

    if (!token) {
      response.badRequest(res, "missing token");
      return;
    }

    const channelId = parseInt(cid);
    if (isNaN(channelId)) {
      response.badRequest(res, "invalid channel id");
      return;
    }

    const channel = this._tokenMap.get(channelId);
    if (!channel) {
      response.notFound(res);
      return;
    }

    if (channel.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      const msg = await channel.queue.pull(parseInt(timeout) || 15000); // default 15s

      response.success(res, msg);
    } catch (e) {
      if (e instanceof QueueTimeoutError) {
        // no message yet
        response.fail(res, "no message yet", 0);
      } else {
        response.internalError(res, e.message);
      }
    }
  }

  private close(channel: MessageChannel) {
    if (channel.socket) {
      channel.socket.disconnect();
      channel.socket = null;
    }

    this._tokenMap.delete(channel.channel.cid);
    this._channelManager.deleteChannel(channel.channel);
    channel.queue.destroy();
    channel.channel.destroy();
  }
}

function infoHtml(version: string, path: string, baudRate: number) {
  return `
<p>Version: ${version}</p>
<p>Connected to ${path}</p>
<p>Baud rate: ${baudRate}</p>`;
}

function randomToken() {
  return (
    Math.random().toString(36).substring(2) +
    Date.now().toString(36) +
    getNextRandomToken()
  );
}

async function calcBufferSha1(buffer: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    hash.update(buffer);
    resolve(hash.digest("hex"));
  });
}

async function calcFileSha1(path: string) {
  const hash = crypto.createHash("sha1");
  const stream = fs.createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
