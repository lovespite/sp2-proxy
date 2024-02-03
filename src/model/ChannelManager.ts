import { Frame } from "./Frame";
import { PhysicalPort } from "./PhysicalPort";
import { Channel } from "./Channel";
import {
  ControlMessage,
  ControllerChannel,
  CtlMessageCommand,
  CtlMessageFlag,
} from "./ControllerChannel";
import getNextRandomToken from "../utils/random";

export interface Controller {
  openChannel(id?: number): Channel;
  closeChannel(chn: Channel): void;
}

export class ChannelManager {
  private _cid: number = 1;

  private readonly _hosts: PhysicalPort[] = [];

  private get primaryHost() {
    return this._hosts[0];
  }

  private get bestHost() {
    if (this._hosts.length === 1) {
      return this.primaryHost;
    }

    // get the lowest back pressure host
    const map = this._hosts
      .map((host) => ({ host, backPressure: host.backPressure }))
      .sort((a, b) => a.backPressure - b.backPressure);

    return map[0].host;
  }

  private getNextCid() {
    return this._cid++;
  }

  private readonly _ctlChannel: ControllerChannel;

  private _packCount: number = 0;
  private _droppedCount: number = 0;

  private count() {
    ++this._packCount;
  }
  private countDrop() {
    ++this._droppedCount;
  }

  public get packCount() {
    return this._packCount;
  }

  public get droppedCount() {
    return this._droppedCount;
  }

  public get controller() {
    return this._ctlChannel;
  }

  private readonly _channels: Map<number, Channel | null | undefined> =
    new Map();
  private readonly _chnManName: string;

  public get name() {
    return this._chnManName;
  }

  public toString() {
    return this.name;
  }

  constructor(primaryHost: PhysicalPort, name: string) {
    this._chnManName = name;

    const controller = {
      openChannel: this.createChannel.bind(this),
      closeChannel: this.deleteChannel.bind(this),
    }; // expose the channel manager's management methods to the controller

    this._ctlChannel = new ControllerChannel(primaryHost, controller);

    this.bindHosts([primaryHost]);
  }

  public bindHosts(hosts: PhysicalPort[]) {
    this._hosts.push(...hosts);
    for (const host of hosts) {
      host.onFrameReceived(this.dispatchFrame.bind(this));
    }
  }

  public async requireConnection(timeout: number = 5000) {
    const tk = getNextRandomToken();
    const msg: ControlMessage = {
      cmd: CtlMessageCommand.ESTABLISH,
      flag: CtlMessageFlag.CONTROL,
      tk,
    };

    return new Promise<Channel>((res, rej) => {
      if (!timeout) timeout = 5000;

      const timeoutHandle = setTimeout(() => {
        rej(new EstablishChannelTimeoutError());
      }, timeout);

      this._ctlChannel.sendCtlMessage(msg, (mSentBack) => {
        if (mSentBack.data && mSentBack.data > 0) {
          const chn = this.createChannel(mSentBack.data as number);
          clearTimeout(timeoutHandle);
          res(chn);
        } else {
          rej(new Error("failed to establish channel"));
        }
      });
    });
  }

  public async releaseConnection(chn: Channel, timeout: number = 5000) {
    const tk = getNextRandomToken();
    const msg: ControlMessage = {
      cmd: CtlMessageCommand.DISPOSE,
      flag: CtlMessageFlag.CONTROL,
      tk,
      data: chn.cid,
    };

    return new Promise<void>((res, rej) => {
      const timeoutHandle = setTimeout(() => {
        rej(new Error("timeout"));
      }, timeout || 5000);

      this._ctlChannel.sendCtlMessage(msg, () => {
        clearTimeout(timeoutHandle);
        this.deleteChannel(chn);
        chn.destroy();
        res();
      });
    });
  }

  public kill(chn: Channel) {
    this.deleteChannel(chn);
    chn.destroy();
  }

  public get(id: number): Channel | undefined {
    return this._channels.get(id);
  }

  public use(id: number) {
    const chn = this.get(id);
    if (chn) {
      return chn;
    }

    return this.createChannel(id);
  }

  public getChannelCount() {
    return this._channels.size;
  }

  public getChannels() {
    return [...this._channels.values()];
  }

  public getChannelIds() {
    return [...this._channels.keys()];
  }

  private createChannel(id?: number) {
    const cid = id || this.getNextCid();
    const channel = new Channel(cid, this.bestHost);
    this._channels.set(cid, channel);
    return channel;
  }

  private deleteChannel(chn: Channel) {
    this._channels.delete(chn.cid);
  }

  public async destroy() {
    this.primaryHost.destroy();
    this.primaryHost.offFrameReceived(this.dispatchFrame);
    this._channels.forEach((chn) => chn?.destroy());
    this._channels.clear();
  }

  private dispatchFrame(frame: Frame) {
    const { data, channelId, id } = frame;

    if (channelId === 0) {
      // controller message
      const message = data.toString("utf8");
      this._ctlChannel.processCtlMessageInternal(message);

      return;
    }

    const channel = this.get(channelId);

    if (!channel) {
      console.warn(
        "[ChnMan]",
        "Frame dropped: ",
        `Chn. <${channelId}> not found`
      );
      this.countDrop();
      return;
    }

    if (channel.destroyed) {
      console.warn(
        "[ChnMan]",
        "Frame dropped: ",
        `Chn. <${channelId}> destroyed`
      );
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
}

export class EstablishChannelTimeoutError extends Error {
  constructor() {
    super("Establish channel timeout");
  }
}
