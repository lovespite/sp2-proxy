import { Frame } from "./Frame";
import { PhysicalPortHost } from "./PhysicalPortHost";
import { Channel, ControllerChannel } from "./Channel";

export class ChannelManager {
  private _cid: number = 1;

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

  constructor(host: PhysicalPortHost, name: string) {
    this._host = host;
    this._chnManName = name;
    host.onFrameReceived(this.dispatchPack.bind(this));
    this._ctlChannel = new ControllerChannel(this._host, this);
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
    const channel = new Channel(cid, this._host);
    this._channels.set(cid, channel);
    return channel;
  }

  public deleteChannel(chn: Channel) {
    this._channels.delete(chn.cid);
  }

  private readonly _host: PhysicalPortHost;

  public async destroy() {
    this._host.destroy();
    this._host.offFrameReceived(this.dispatchPack);
    this._channels.forEach(chn => chn?.destroy());
    this._channels.clear();
  }

  private dispatchPack(pack: Frame) {
    const { data, channelId, id } = pack;

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
