export function ipbytes(ip: string): number[] {
  return ip.split(".").map((v) => parseInt(v));
}

export function ipstr(bytes: number[]): string {
  return bytes.join(".");
}

export function ipbytes_uint32(ip: string): number {
  return ipbytes(ip).reduce((acc, v) => (acc << 8) | v);
}

export function ipbytes_uint8array(ip: string): Uint8Array {
  return new Uint8Array(ipbytes(ip));
}