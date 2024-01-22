export type Frame = {
  channelId: number; // channel id
  id: number;
  data: Buffer; // buffer
  length: number;
  keepAlive?: boolean;
};
