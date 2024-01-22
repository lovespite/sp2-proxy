import { Transform, TransformCallback } from "stream";
import { Frame } from "../model/Frame";

export const MetaSize = 16; // 16 bytes (head)
export const DataSegmentSize = 1500;

export const EscapeChar: number = 0x10; // DLE
export const FrameBeg: number = 0x02; // STX
export const FrameEnd: number = 0x03; // ETX
export const SpecialChars = [EscapeChar, FrameBeg, FrameEnd]; // 定义需要转义的特殊字符
const SpecialCharSet = new Set(SpecialChars);

export function escapeBuffer(buffer: Buffer) {
  let estimatedSize = buffer.length;

  for (const byte of buffer) {
    if (SpecialCharSet.has(byte)) {
      estimatedSize++;
    }
  }

  const escapedBuffer = Buffer.allocUnsafe(estimatedSize);
  let tarPos = 0;

  for (const byte of buffer) {
    if (SpecialCharSet.has(byte)) {
      escapedBuffer[tarPos++] = EscapeChar;
      escapedBuffer[tarPos++] = byte ^ 0xff;
    } else {
      escapedBuffer[tarPos++] = byte;
    }
  }

  return escapedBuffer;
}

export function unescapeBuffer(escapedBuffer: Buffer) {
  const buffer = Buffer.allocUnsafe(escapedBuffer.length);
  let tarPos = 0;

  for (let srcPos = 0; srcPos < escapedBuffer.length; srcPos++) {
    const byte = escapedBuffer[srcPos];
    if (byte === EscapeChar) {
      const nextByte = escapedBuffer[srcPos + 1];
      buffer[tarPos++] = nextByte ^ 0xff;
      srcPos++; // 跳过转义序列的下一个字节
    } else {
      buffer[tarPos++] = byte;
    }
  }

  return buffer.subarray(0, tarPos);
}

export function buildNullFrameObj(cid: number, keepAlive?: boolean): Frame {
  return {
    channelId: cid,
    id: 0,
    data: buildFrameBuffer(Buffer.allocUnsafe(0), cid),
    length: 0,
    keepAlive,
  };
}

export function buildFrameBuffer(chunk: Buffer, cid: number): Buffer {
  const buffer = Buffer.allocUnsafe(chunk.length + MetaSize); // allocate buffer

  buffer.writeBigInt64LE(BigInt(cid), 0); // channel id, 8 bytes
  buffer.writeBigInt64LE(BigInt(chunk.length), 8); // chunk length, 8 bytes
  buffer.set(chunk, MetaSize); // copy escaped buffer

  return escapeBuffer(buffer);
}

export function parseFrameBuffer(frame: Buffer): Frame {
  const buffer = unescapeBuffer(frame);

  const cid = Number(buffer.readBigInt64LE(0)); // 8 bytes
  const length = Number(buffer.readBigInt64LE(8)); // 8 bytes
  const data = buffer.subarray(16, 16 + length);

  return {
    channelId: cid,
    length,
    id: 0,
    data,
  };
}

export function slice(data: Buffer, cid: number): Frame[] {
  const packs: Frame[] = [];

  let index = 0;
  let offset = 0;

  while (offset < data.length) {
    const dataSlice = data.subarray(offset, offset + DataSegmentSize);
    const pack = {
      channelId: cid,
      id: index,
      data: buildFrameBuffer(dataSlice, cid),
      length: dataSlice.length,
    };
    packs.push(pack);
    offset += DataSegmentSize;
    ++index;
  }

  return packs;
}

export class ReadFrameParser extends Transform {
  private buffer: Buffer = Buffer.alloc(0);

  constructor() {
    super();
  }

  _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const frameStartIndex = this.buffer.indexOf(FrameBeg);
      if (frameStartIndex === -1) break;

      const frameEndIndex = this.buffer.indexOf(FrameEnd, frameStartIndex + 1);
      if (frameEndIndex === -1) break;

      const frameSize = frameEndIndex - frameStartIndex - 1;

      if (frameSize < MetaSize) {
        // invalid frame size
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
}

export function printBuffer(buffer: Buffer) {
  const lines = [];

  for (let i = 0; i < buffer.length; i += 16) {
    const bufLine = buffer.subarray(i, i + 16);
    const line = [...buffer.subarray(i, i + 16)];
    const hex = line.map(byte => byte.toString(16).padStart(2, "0")).join(" ");
    const chars = bufLine.toString("utf8").replace(/[\x00-\x1f\x7f-\xff]/g, ".");
    lines.push(`${hex.padEnd(48)} | ${chars}`);
  }

  console.log(lines.join("\n"));
}
