import { Frame } from "./Frame";
import { PhysicalPort } from "./PhysicalPort";
import { Channel } from "./Channel";
import { ControllerChannel } from "./ControllerChannel";

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
      .map(host => ({ host, backPressure: host.backPressure }))
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

  public get ctlChannel() {
    return this._ctlChannel;
  }

  private readonly _channels: Map<number, Channel | null | undefined> = new Map();
  private readonly _chnManName: string;

  public get name() {
    return this._chnManName;
  }

  public toString() {
    return this.name;
  }

  constructor(primaryHost: PhysicalPort, name: string) {
    this._chnManName = name;
    this._ctlChannel = new ControllerChannel(primaryHost, this);
    this.bindHosts([primaryHost]);
  }

  public bindHosts(hosts: PhysicalPort[]) {
    this._hosts.push(...hosts);
    for (const host of hosts) {
      host.onFrameReceived(this.dispatchFrame.bind(this));
    }
  }

  public getChannel(id: number): Channel | undefined {
    return this._channels.get(id);
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

  public createChannel(id?: number) {
    const cid = id || this.getNextCid();
    const channel = new Channel(cid, this.bestHost);
    this._channels.set(cid, channel);
    return channel;
  }

  public deleteChannel(chn: Channel) {
    this._channels.delete(chn.cid);
  }

  public async destroy() {
    this.primaryHost.destroy();
    this.primaryHost.offFrameReceived(this.dispatchFrame);
    this._channels.forEach(chn => chn?.destroy());
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
}
