import { Transform, TransformCallback } from "stream";
import { Frame } from "../model/Frame";

export const MetaSize = 16; // 16 bytes (head)
export const MaxTransmitionUnitSize = 1500; // 1500 bytes (MTU)

export const EscapeChar: number = 0x10; // DLE, Data Link Escape
export const FrameBeg: number = 0x02; // STX, Start of Context
export const FrameEnd: number = 0x03; // ETX, End of Context

export const EscapeChar_Escaped: number = EscapeChar ^ 0xff;
export const FrameBeg_Escaped: number = FrameBeg ^ 0xff;
export const FrameEnd_Escaped: number = FrameEnd ^ 0xff;

export const SpecialChars = [EscapeChar, FrameBeg, FrameEnd]; // 定义需要转义的特殊字符
export const SpecialChars_Escaped = [EscapeChar_Escaped, FrameBeg_Escaped, FrameEnd_Escaped]; // 定义转义后的特殊字符

export const SpecialCharRatioThreshold = 0.077; // 特殊字符数量阈值

export function escapeBuffer(buffer: Buffer) {
  const scp = scanBuffer(buffer);

  if (scp.length === 0) return buffer;

  const ratio = scp.length / buffer.length;

  let bf: Buffer;

  // 如果特殊字符数量小于阈值时，则使用 BlockCopy 算法
  if (ratio < SpecialCharRatioThreshold) {
    bf = escapeBufferInternal_BlockCopy(buffer, scp);
  } else {
    bf = escapeBufferInternal_ByteByByte(buffer, scp);
  }

  return bf;
}

export function constructTestBuffer(size: number, specialCharRatio: number): [Buffer, number] {
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

export function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = crc ^ buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return crc ^ 0xffffffff;
}

export function testEscapeBuffer(buffer: Buffer) {
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

function scanBuffer(buffer: Buffer): number[] {
  const specialCharPositions = [];
  let sIndex: number = -1;

  for (let i = 0; i < buffer.length; i++) {
    sIndex = SpecialChars.indexOf(buffer[i]);
    if (sIndex === -1) continue;
    specialCharPositions.push((i << 2) | sIndex); // 用低2位存储特殊字符索引
  }

  return specialCharPositions;
}

function escapeBufferInternal_ByteByByte(buffer: Buffer, specialCharPositions: number[]) {
  let estimatedSize = buffer.length + specialCharPositions.length;

  const escapedBuffer = Buffer.allocUnsafe(estimatedSize);
  let tarPos = 0;
  let byte: number;
  let sIndex: number = -1;

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

function escapeBufferInternal_BlockCopy(buffer: Buffer, specialCharPositions: number[]) {
  // 根据特殊字符数量，计算新Buffer的大小
  const escapedBufferSize = buffer.length + specialCharPositions.length;
  const escapedBuffer = Buffer.allocUnsafe(escapedBufferSize);
  let readPos = 0;
  let writePos = 0;

  let pos = 0;
  let sIndex = 0;
  // 根据特殊字符位置填充新Buffer
  for (const bitMergedPos of specialCharPositions) {
    pos = bitMergedPos >> 2; // 取高30位
    sIndex = bitMergedPos & 0b11; // 取低2位
    // 拷贝直到特殊字符的连续块
    buffer.copy(escapedBuffer, writePos, readPos, pos);
    writePos += pos - readPos;

    // 添加转义字符和转义后的特殊字符
    escapedBuffer[writePos++] = EscapeChar;
    escapedBuffer[writePos++] = SpecialChars_Escaped[sIndex];
    readPos = pos + 1;
  }

  // 拷贝最后一块数据（如果有的话）
  if (readPos < buffer.length) {
    buffer.copy(escapedBuffer, writePos, readPos);
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

/**
 * 将数据分片
 * @param data
 * @param cid
 * @returns
 */
export function slice(data: Buffer, cid: number): Frame[] {
  const packs: Frame[] = [];

  let index = 0;
  let offset = 0;

  while (offset < data.length) {
    const dataSlice = data.subarray(offset, offset + MaxTransmitionUnitSize);
    const pack = {
      channelId: cid,
      id: index,
      data: buildFrameBuffer(dataSlice, cid),
      length: dataSlice.length,
    };
    packs.push(pack);
    offset += MaxTransmitionUnitSize;
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
