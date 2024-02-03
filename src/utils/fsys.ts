import fs, { PathLike, PathOrFileDescriptor, stat } from "fs";
import crypto from "crypto";

export enum PathType {
  NOT_FOUND = 0,
  FILE = 1,
  DIR = 2,
  UNKNOWN = 3,
}

export enum DataType {
  STRING = 0,
  BUFFER = 1,
}

export async function path_type_of(path: string) {
  return new Promise((resolve) => {
    stat(path, (err, s) => {
      if (err) {
        resolve(PathType.NOT_FOUND);
      } else {
        if (s.isFile()) {
          resolve(PathType.FILE);
        } else if (s.isDirectory()) {
          resolve(PathType.DIR);
        } else {
          resolve(PathType.UNKNOWN);
        }
      }
    });
  });
}

export async function f_exists(path: string) {
  return (await path_type_of(path)) === PathType.FILE;
}

export async function d_exists(path: string) {
  return (await path_type_of(path)) === PathType.DIR;
}

export async function mkdir(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.mkdir(path, (err) => {
      if (err) {
        if (err.errno === -4075) {
          resolve(true);
        } else {
          resolve(false);
        }
      } else {
        resolve(true);
      }
    });
  });
}

export async function touch(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.writeFile(path, "", (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export async function write_file(
  path: string,
  data: string | Buffer
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (typeof data === "string" || data instanceof Buffer) {
      fs.writeFile(path, data, (err) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } else {
      reject(new Error("Invalid data type"));
    }
  });
}

export async function read_file(
  path: string,
  readType: DataType = DataType.STRING,
  encoding: BufferEncoding = "utf8"
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    switch (readType) {
      case DataType.BUFFER: {
        fs.readFile(path, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
        break;
      }
      default:
      case DataType.STRING: {
        fs.readFile(path, { encoding }, (err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
        break;
      }
    }
  });
}

export function hash(data: Buffer | PathLike, algorithm: string = "sha1") {
  return new Promise<string>((resolve, reject) => {
    if (data instanceof Buffer) {
      calcBufferSha1(data, algorithm)
        .then((hash) => {
          resolve(hash);
        })
        .catch((err) => {
          reject(err);
        });
    } else {
      calcFileSha1(data, algorithm)
        .then((hash) => {
          resolve(hash);
        })
        .catch((err) => {
          reject(err);
        });
    }
  });
}

export function rm(path: string, recursive: boolean = true) {
  return new Promise((resolve, reject) => {
    fs.rm(path, { recursive }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

export function try_rm(path: string, recursive: boolean = true) {
  return new Promise((resolve) => {
    fs.rm(path, { recursive }, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export function cp(src: string, dest: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    fs.copyFile(src, dest, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export function rename(src: string, dest: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    fs.rename(src, dest, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export function open_read(path: PathLike) {
  return fs.createReadStream(path);
}

export function open_write(path: PathLike) {
  return fs.createWriteStream(path);
}

async function calcBufferSha1(buffer: Buffer, algorithm: string) {
  return await new Promise<string>((resolve) => {
    const hash = crypto.createHash(algorithm);
    hash.update(buffer);
    resolve(hash.digest("hex"));
  });
}

async function calcFileSha1(path: PathLike, algorithm: string) {
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
