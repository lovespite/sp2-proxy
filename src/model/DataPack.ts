export type DataPack = {
  cid: number; // channel id
  id: number;
  data: string; // base64 encoded data slice,
  end?: boolean; // end of data
};

export function getNullPack(cid: number): DataPack {
  return {
    cid,
    id: 0,
    data: null,
  };
}

// export function sortAndCheckPacks(packs: DataPack[]): boolean {
//   if (packs.length === 0) return false;

//   packs.sort((a, b) => a.index - b.index);
//   const total = packs[0].total;
//   if (packs.length !== total) return false;

//   return true;
// }

// export function stringToBuffer(str: string): Buffer {
//   return Buffer.from(str, "utf8");
// }

// export function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
//   return new Promise((resolve, reject) => {
//     const chunks: Buffer[] = [];
//     stream.on("data", chunk => chunks.push(chunk));
//     stream.on("error", reject);
//     stream.on("end", () => resolve(Buffer.concat(chunks)));
//   });
// }

// export function convertToBuffer(packs: DataPack[]): Buffer {
//   const base64 = packs.map(pack => pack.data).join("");
//   return Buffer.from(base64, "base64");
// }

export function slice(data: Buffer, cid: number, maxPackSize: number = 1024): DataPack[] {
  const packs: DataPack[] = [];

  let index = 0;
  let offset = 0;

  while (offset < data.length) {
    const pack: DataPack = {
      cid,
      id: index,
      data: data.subarray(offset, offset + maxPackSize).toString("base64"),
    };
    packs.push(pack);
    offset += maxPackSize;
    ++index;
  }

  return packs;
}
