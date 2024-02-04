import { Frame } from "./Frame";
import { PhysicalPort } from "./PhysicalPort";
import { Channel } from "./Channel";
import { ControllerChannel, CtlMessageCommand } from "./ControllerChannel";

export interface Controller {
  openChannel(id?: number): Channel;
  closeChannel(chn: Channel, code: number): void;
}

export class ChannelManager {
  private _cid: number = 1;

  private readonly _hosts: PhysicalPort[] = [];

  constructor(primaryHost: PhysicalPort, name: string) {
    this._chnManName = name;

    const controller = {
      openChannel: this.createChannel.bind(this),
      closeChannel: this.kill.bind(this),
    }; // expose the channel manager's management methods to the controller

    this._ctlChannel = new ControllerChannel(primaryHost, controller);

    this.bindHosts([primaryHost]);
  }

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
    const t = Number(Date.now()); // int64 0x0000_0000_0000_0000 - 0xFFFF_FFFF_FFFF_FFFF
    const u = this._cid++; // int32 0x0000_0000 - 0xFFFF_FFFF
    const r = Math.ceil(Math.random() * 0xffff); // int16 0x0000 - 0xFFFF

    // console.log(t, u, r);
    const cid = t ^ (u << 32) ^ (r << 48);
    // console.log(cid);
    // t: 0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000
    //    64                                      32                  16             4

    // u: 0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000
    //    ^^^^ ^^^^ ^^^^ ^^^^ ^^^^ ^^^^ ^^^^ ^^^^
    //    64

    // r: 0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000
    //    ^^^^ ^^^^ ^^^^ ^^^^
    //    64

    return Math.abs(cid);
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
  public bindHosts(hosts: PhysicalPort[]) {
    this._hosts.push(...hosts);
    for (const host of hosts) {
      host.onFrameReceived(this.dispatchFrame.bind(this));
    }
  }

  public async requireConnection(timeout: number = 5000) {
    const ret = await this.controller.callRemoteProc(
      { cmd: CtlMessageCommand.ESTABLISH },
      timeout
    );

    if (ret.data && ret.data > 0) {
      return this.createChannel(ret.data as number);
    } else {
      throw new Error("failed to establish channel");
    }
  }

  public async releaseConnection(chn: Channel, timeout: number = 5000) {
    this.kill(chn, 0xfff1);

    await this.controller.callRemoteProc(
      {
        cmd: CtlMessageCommand.DISPOSE,
        data: chn.cid,
      },
      timeout
    );
  }

  public kill(chn: Channel | number, code: number) {
    if (typeof chn === "number") {
      chn = this.get(chn);

      if (!chn) return;
    }

    this._channels.delete(chn.cid);
    chn.destroy();

    console.log(
      `[ChnMan] Channel <${chn.cid}> destroyed`,
      `0x${code.toString(16)}`
    );
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
