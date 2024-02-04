import { ReadlineParser, SerialPort } from "serialport";
import { PhysicalPort } from "../model/PhysicalPort";
import express, { Response, Request } from "express";
import * as ws from "socket.io";
import { ServerOptions, createServer } from "https";
import { ChannelManager } from "../model/ChannelManager";
import { BlockQueue, QueueTimeoutError } from "../model/BlockQueue";
import * as response from "../utils/success";
import { Channel } from "../model/Channel";
import getNextRandomToken from "../utils/random";
import os from "os";

import {
  ControlMessage,
  CtlMessageFlag,
  CtlMessageSendBackDelegate,
} from "../model/ControllerChannel";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import path from "path";
import * as fsys from "../utils/fsys";

const version = "2.0.0a";
const root = __dirname;
const static_root = path.resolve(root, "app", "static");
const static_root2 = path.resolve(os.homedir(), "sp2mux-files");

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
  childProcess?: ChildProcessWithoutNullStreams;
  remoteShellChannelId?: number;
};

enum ExMessageCmd {
  GET_CHANNELS = "&00",
  SHELL = "&01",
  REC_FILE = "&02",
  REC_IMAGE = "&03",
}

export class Messenger {
  private readonly _host: PhysicalPort;
  private readonly _channelManager: ChannelManager;
  private readonly _systemChannels: Set<number>;

  private readonly _msgMans: Map<number, MessageChannel> = new Map();

  private release(cid: number) {
    this._msgMans.delete(cid);
  }

  private isLocked(cid: number) {
    return this._msgMans.has(cid);
  }

  private lock(mc: MessageChannel) {
    if (this._msgMans.has(mc.channel.cid)) throw new Error("channel locked");
    this._msgMans.set(mc.channel.cid, mc);
  }

  private tryGet(cid: number): MessageChannel | null {
    return this._msgMans.get(cid) || null;
  }

  public constructor(sp: SerialPort) {
    this._host = new PhysicalPort(sp);
    this._channelManager = new ChannelManager(this._host, "messenger");

    this._channelManager.controller.onCtlMessageReceived((msg, callback) => {
      // console.log("control message received", msg);
      this.handleControlMessage(msg, callback).catch(console.log);
    });

    this._systemChannels = new Set();
  }

  private lockSystemChannel(cid: number) {
    this._systemChannels.add(cid);
  }

  private async requireSystemChannel() {
    const chn = await this._channelManager.requireConnection();
    this.lockSystemChannel(chn.cid);

    return chn;
  }

  private releaseSystemChannel(chn: Channel) {
    this._systemChannels.delete(chn.cid);
    this._channelManager.releaseConnection(chn);
  }

  private isSystemChannel(cid: number) {
    return this._systemChannels.has(cid);
  }

  private async getRemoteChannels() {
    const msg = {
      cmd: ExMessageCmd.GET_CHANNELS,
    };

    const ret = await this._channelManager.controller.callRemoteProc(msg);

    if (!ret.data) return [];

    return ret.data as number[];
  }

  private async handleControlMessage(
    msg: ControlMessage,
    sb: CtlMessageSendBackDelegate
  ) {
    switch (msg.cmd) {
      case ExMessageCmd.GET_CHANNELS: {
        const ids = this._channelManager.getChannelIds();
        msg.flag = CtlMessageFlag.CALLBACK;
        msg.data = ids.filter((id) => !this.isSystemChannel(id));
        sb(msg);
        break;
      }

      case ExMessageCmd.SHELL: {
        // shell command
        const { command } = msg.data as { command: string; cid: number };
        // const msgChannel = this._tokenMap.get(cid);

        if (!command) {
          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = { message: "invalid command", success: false };
          sb(msg);
          return;
        }

        const sChannel = await this.requireSystemChannel();

        try {
          const child = spawn(command, {
            cwd: os.homedir(),
            shell: true,
            stdio: "pipe",
          });

          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");

          sChannel.pipe(child.stdin);
          child.stdout.pipe(sChannel);
          child.stderr.pipe(sChannel);

          child.once("exit", (code, signal) => {
            sChannel.finish();
            this.releaseSystemChannel(sChannel);
            console.log("shell command exit", code, signal);
          });

          // msgChannel.childProcess = child;
          sChannel.once("end", () => {
            try {
              console.log("shell channel closed, process exiting...");
              child.kill();
            } catch (e) {
              // ignore
            }
          });

          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = {
            message: "established",
            success: true,
            cid: sChannel.cid,
          };

          sb(msg);
        } catch (e) {
          msg.flag = CtlMessageFlag.CALLBACK;
          msg.data = { message: e.message, success: false };

          sb(msg);
        }

        break;
      }

      case ExMessageCmd.REC_IMAGE:
      case ExMessageCmd.REC_FILE: {
        const { name, cid, sha1 } = msg.data as {
          name: string;
          cid: number | null;
          sha1: string;
        };

        const msgChannel = cid ? this.tryGet(cid) || null : null;

        const ext = "." + name.split(".").pop() || "bin";

        const fileName = `${getNextRandomToken()}${ext}`;

        const fullName = path.resolve(static_root2, fileName);
        const uri = `/files/${fileName}`;

        const dir_ok = await fsys.mkdir(static_root2);

        if (!dir_ok) {
          console.error("failed to create directory", static_root2);
          msg.data = null;
          msg.flag = CtlMessageFlag.CALLBACK;
          sb(msg);
          return;
        }

        const fChannel = await this.requireSystemChannel();

        const writable = fsys.open_write(fullName);
        fChannel.pipe(writable);

        fChannel.once("end", async () => {
          writable.close();
          this.releaseSystemChannel(fChannel);

          const sha1File = await fsys.hash(fullName);

          if (sha1File !== sha1) {
            fsys.try_rm(fullName);

            msgChannel?.queue.enqueue({
              type: MessageContentType.Text,
              content: "[文件/图片传输失败：文件校验错误]",
              mineType: "text/plain",
            });
          } else {
            msgChannel?.queue.enqueue({
              type:
                msg.cmd === ExMessageCmd.REC_IMAGE
                  ? MessageContentType.Image
                  : MessageContentType.File,
              content: uri,
              fileName: name, // original file name
              mineType: "application/octet-stream",
            });
          }
        });

        msg.flag = CtlMessageFlag.CALLBACK;
        msg.data = fChannel.cid;
        sb(msg);
        break;
      }

      default: {
        break;
      }
    }
  }

  private async buffer(
    cmd: ExMessageCmd,
    name: string,
    buffer: Buffer,
    channelId?: number
  ) {
    const tmpFile = path.resolve(os.tmpdir(), getNextRandomToken());

    const tmp = fsys.open_write(tmpFile);
    tmp.write(buffer);

    await new Promise<void>((resolve, reject) => {
      tmp.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const sha1 = await fsys.hash(tmpFile);

    const ret = await this._channelManager.controller.callRemoteProc({
      cmd,
      data: {
        name: decodeURIComponent(name),
        cid: channelId,
        sha1,
      },
    });

    if (!ret.data) throw new Error("failed to open channel");

    console.log("file channel established", ret.data);

    const cid = ret.data as number;
    const fChannel = this._channelManager.get(cid);

    if (!fChannel) throw new Error("failed to open channel");

    const readable = fsys.open_read(tmpFile);
    readable.pipe(fChannel);

    return new Promise<void>((resolve) => {
      readable.once("end", () => {
        fsys.try_rm(tmpFile);
        resolve();
      });
    });
  }

  public async start({ port, listen }: { port: number; listen: string }) {
    const app = express();
    const options: ServerOptions = {
      key: await fsys.read_file(
        path.resolve(__dirname, "server.key"),
        fsys.DataType.BUFFER
      ),
      cert: await fsys.read_file(
        path.resolve(__dirname, "server.cert"),
        fsys.DataType.BUFFER
      ),
    };
    const server = createServer(options, app);
    const wsio = new ws.Server(server);

    wsio.on("connection", this.onConnection.bind(this));

    app.use("/api", express.json({ limit: "100kb" }));
    app.use(
      "/raw",
      express.raw({ type: "application/octet-stream", limit: "50mb" })
    );

    app.get("/api/sysinfo", this.getSysInfo.bind(this));

    app.get("/api/channels", this.getChannels.bind(this));
    app.post("/api/channel", this.openChannel.bind(this));
    app.delete("/api/channel/:cid", this.closeChannel.bind(this));
    app.post("/api/message", this.postTextMessage.bind(this));
    app.get("/api/message/:cid", this.pullMessage.bind(this));
    app.post("/api/shell/:cid", this.postShell.bind(this));

    app.post("/raw/image/:cid", this.postImage.bind(this));
    app.post("/raw/file/:cid", this.postFile.bind(this));

    app.use(express.static(static_root));
    app.use("/files", express.static(static_root2));

    server.listen(port, listen, () => {
      console.log(`Working on https://${listen}:${port}`);
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

    const h = setInterval(() => {
      socket.emit("sysinfo", {
        version,
        path: this._host.path,
        baudRate: this._host.baudRate,
        frames: this._channelManager.frameCount,
        droppedFrames: this._channelManager.droppedCount,
        traffic: this._host.traffic,
      });
    }, 1000);

    socket.once("disconnect", () => {
      clearInterval(h);
    });

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
  }

  private async connectSocketToChannel(
    socket: ws.Socket,
    cid: number,
    token: string
  ) {
    const msgMan = this.tryGet(cid);

    if (!msgMan) {
      return { success: false, message: "channel not found" };
    }

    if (msgMan.token !== token) {
      return { success: false, message: "unauthorized" };
    }

    if (msgMan.socket) {
      msgMan.socket.removeAllListeners();
      msgMan.socket.disconnect();
      msgMan.socket = null;
    }

    msgMan.socket = socket;
    msgMan.queue.onItemQueued = (item) => {
      socket.emit("data", item);

      // no need to keep the item in the queue since we handled it here
      return false;
    };

    return { success: true, message: "ok" };
  }

  // ============== http handlers ==============

  /**
   * get /api/sysinfo
   * @param req
   * @param res
   */
  private async getSysInfo(req: Request, res: Response) {
    response.success(res, {
      version,
      path: this._host.path,
      baudRate: this._host.baudRate,
      frames: this._channelManager.frameCount,
      droppedFrames: this._channelManager.droppedCount,
      traffic: this._host.traffic,
    });
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

      if (cid && this.isLocked(cid)) {
        response.success(res, {
          token: this.tryGet(cid).token,
          cid,
        });
        return;
      }

      const channel = cid
        ? // use existing channel
          this._channelManager.use(cid)
        : // create new channel
          await this._channelManager.requireConnection();

      const queue = new BlockQueue<Message>(10000);
      const token = getNextRandomToken().padStart(6, "a");

      channel.once("end", () => {
        const msgChan = this.tryGet(channel.cid);
        if (!msgChan) {
          // already released}
          console.log("Channel already released:", channel.cid);
          return;
        }

        console.log("Closing channel:", channel.cid);

        msgChan?.socket?.emit("error", {
          success: false,
          message: "channel closed",
        });

        this.release(channel.cid);
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

      this.lock({ token, channel, queue });

      response.success(res, { token, cid: channel.cid });
    } catch (e) {
      console.log(e);
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

    const msgMan = this.tryGet(channelId);
    if (!msgMan) {
      response.success(res, "channel released already");
      return;
    }

    if (msgMan.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      this.close(msgMan);
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

    const { channel, token: cToken } = this.tryGet(cid) || {};

    if (!channel || channel.destroyed) {
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
   * post /api/shell/:cid?token=xxx -> { command: "ls -l" }
   * @param req
   * @param res
   */
  private async postShell(req: Request, res: Response) {
    const { cid } = req.params as { cid: string };
    const { token, sid } = req.query as { token: string; sid: string };
    const { command } = req.body as { command: string };

    if (!token) {
      response.badRequest(res, "missing token");
      return;
    }

    if (!command) {
      response.badRequest(res, "missing command");
      return;
    }

    if (sid) {
      const shellChannelId = parseInt(sid);
      const chn = this._channelManager.get(shellChannelId);

      if (chn) {
        chn.write(command + "\r\n");

        response.success(res, {
          shellChannel: shellChannelId,
        });

        return;
      } else {
        response.fail(res, "shell channel released");
        return;
      }
    }

    const channelId = parseInt(cid);
    if (isNaN(channelId)) {
      response.badRequest(res, "invalid channel id");
      return;
    }
    const msgChannel = this.tryGet(channelId);

    if (!msgChannel) {
      response.notFound(res);
      return;
    }

    if (msgChannel.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      const msgback = (
        await this._channelManager.controller.callRemoteProc({
          cmd: ExMessageCmd.SHELL,
          data: {
            command,
            cid: channelId,
          },
        })
      ).data as unknown as { success: boolean; message: string; cid: number };

      if (!msgback) return response.fail(res, "failed to open shell channel");
      if (!msgback.success) return response.fail(res, msgback.message);
      if (!msgback.cid) return response.fail(res, "invalid shell channel");

      const sChannel = this._channelManager.get(msgback.cid);
      msgChannel.remoteShellChannelId = msgback.cid;

      sChannel
        .pipe(
          new ReadlineParser({
            delimiter: "\r\n",
          })
        )
        .on("data", (line) => {
          msgChannel.queue.enqueue({
            type: MessageContentType.Text,
            content: line,
            mineType: "text/plain",
          });
        });

      response.success(res, {
        shellChannel: msgback.cid,
      });
    } catch (e) {
      console.log(e);
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

    const msgChannel = this.tryGet(channelId);

    if (!msgChannel) {
      response.notFound(res);
      return;
    }

    if (msgChannel.token !== token) {
      response.accessDenied(res);
      return;
    }

    try {
      await this.buffer(ExMessageCmd.REC_IMAGE, name, buffer, channelId);

      response.success(res, "ok");
    } catch (e) {
      console.log(e);
      response.internalError(res, e.message);
    }
  }

  /**
   * post /raw/file/:cid?name=xxx
   * @param req
   * @param res
   */
  private async postFile(req: Request, res: Response) {
    const { cid } = req.params as { cid: string };
    const { name } = req.query as { name: string };
    const buffer = req.body as Buffer;

    if (!name) {
      response.badRequest(res, "missing name");
      return;
    }

    let channelId = parseInt(cid);
    if (isNaN(channelId)) {
      channelId = null;
    }

    try {
      await this.buffer(ExMessageCmd.REC_FILE, name, buffer, channelId);

      response.success(res, "ok");
    } catch (e) {
      console.log(e);
      response.internalError(res, e.message);
    }
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

    const channel = this.tryGet(channelId);
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

  private close(msgMan: MessageChannel) {
    if (msgMan.socket) {
      // close websocket
      msgMan.socket.disconnect();
      msgMan.socket = null;
    }

    if (msgMan.childProcess) {
      // kill shell process
      msgMan.childProcess.kill();
      msgMan.childProcess = null;
    }

    if (msgMan.remoteShellChannelId) {
      // close remote shell channel
      try {
        const chn = this._channelManager.get(msgMan.remoteShellChannelId);
        chn?.write("exit\r\n");
        chn?.write("exit\r\n");
      } catch (e) {
        console.log(e);
      }
    }

    this.release(msgMan.channel.cid);
    this._channelManager.releaseConnection(msgMan.channel);
    msgMan.queue.destroy();
    msgMan.channel.destroy();
  }
}
