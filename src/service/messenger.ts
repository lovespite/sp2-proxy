import { ReadlineParser, SerialPort } from "serialport";
import { PhysicalPort } from "../model/PhysicalPort";
import express, { Response, Request } from "express";
import { ChannelManager } from "../model/ChannelManager";
import { BlockQueue, QueueTimeoutError } from "../model/BlockQueue";
import * as response from "../utils/success";
import { Channel } from "../model/Channel";
import getNextRandomToken from "../utils/random";

const version = "0.0.1";
const root = __dirname;
const static_root = root + "\\app\\static";

export class Messenger {
  private readonly _host: PhysicalPort;
  private readonly _channelManager: ChannelManager;

  private readonly _tokenMap: Map<number, MessageChannel> = new Map();

  public constructor(sp: SerialPort) {
    this._host = new PhysicalPort(sp);
    this._channelManager = new ChannelManager(this._host, "messenger");
  }

  public async start({ port, listen }: { port: number; listen: string }) {
    const task = this._host.start();
    const app = express();

    app.use(express.json({ limit: "10mb" }));

    app.get("/info", this.getInfo.bind(this));
    app.get("/api/channels", this.getChannels.bind(this));
    app.post("/api/channel", this.openChannel.bind(this));
    app.delete("/api/channel/:cid", this.closeChannel.bind(this));
    app.post("/api/file", this.postFile.bind(this));
    app.get("/api/file/:fid", this.pullFile.bind(this));
    app.post("/api/message", this.postMessage.bind(this));
    app.get("/api/message/:cid", this.pullMessage.bind(this));

    app.use(express.static(static_root));
    app.listen(port, listen, () => {
      console.log(`Mount to: ${static_root}`);
      console.log(`Listening on http://${listen}:${port}`);
    });

    await task;
  }

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
    const ids = this._channelManager.getChannelIds();
    response.success(res, ids);
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
          queue.enqueue({ type: MessageContentType.Text, content: line });
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
      this._channelManager.deleteChannel(channel.channel);
      channel.channel.destroy();
      response.success(res, "ok");
    } catch (e) {
      response.internalError(res, e.message);
    }
  }

  private async postFile(req: Request, res: Response) {
    res.status(501).json({ success: false, message: "Not implemented" });
  }
  private async pullFile(req: Request, res: Response) {
    res.status(501).json({ success: false, message: "Not implemented" });
  }

  /**
   * post /api/message -> { token: "xxx", cid: 1, type: 0, content: "hello" }
   * @param req
   * @param res
   * @returns
   */
  private async postMessage(req: Request, res: Response) {
    const { token, cid, type, content } = req.body as {
      token: string;
      cid: number;
      content: string;
      type?: MessageContentType;
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
        type: type === undefined ? MessageContentType.Text : type,
        content: content,
      };
      const buffer = Buffer.from(JSON.stringify(msg) + "\r\n", "utf8");
      channel.write(buffer);
      response.success(res, "ok");
    } catch (e) {
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
}

function infoHtml(version: string, path: string, baudRate: number) {
  return `
<p>Version: ${version}</p>
<p>Connected to ${path}</p>
<p>Baud rate: ${baudRate}</p>`;
}

enum MessageContentType {
  Text = 0,
  File = 1,
  Image = 2,
}

type Message = {
  type: MessageContentType;
  content: string;
};

type MessageChannel = {
  token: string;
  channel: Channel;
  queue: BlockQueue<Message>;
};
