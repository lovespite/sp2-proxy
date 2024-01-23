import { Transform, TransformCallback } from "stream";
import { FrameBeg, FrameEnd, MetaSize } from "../utils/frame";

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
