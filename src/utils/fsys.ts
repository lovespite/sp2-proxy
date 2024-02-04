import fs from "fs";
import crypto from "crypto";
import os from "os";
import { exec } from "child_process";
import path from "path";

export enum PathType {
  NOT_FOUND = 0,
  FILE = 1,
  DIR = 2,
  UNIX_DEVICE = 3,
  UNKNOWN = 5,
}

export enum DataType {
  STRING = 0,
  BUFFER = 1,
}

export async function stat_of(path: fs.PathLike): Promise<fs.Stats> {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        resolve(stats);
      }
    });
  });
}

export async function path_type_of(path: string) {
  const stat = await stat_of(path);
  if (stat.isFile()) {
    return PathType.FILE;
  } else if (stat.isDirectory()) {
    return PathType.DIR;
  } else if (stat.isBlockDevice() || stat.isCharacterDevice()) {
    return PathType.UNIX_DEVICE;
  } else {
    return PathType.UNKNOWN;
  }
}

export async function path_size_of(path: string) {
  const { size } = await stat_of(path);
  return size;
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
        console.error(err);
        if (
          err.errno === -4075 || // windows
          err.errno === -17 // darwin
        ) {
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

export function hash(data: Buffer | fs.PathLike, algorithm: string = "sha1") {
  return new Promise<string>((resolve, reject) => {
    if (data instanceof Buffer) {
      hash_buffer(data, algorithm)
        .then((hash) => {
          resolve(hash);
        })
        .catch((err) => {
          reject(err);
        });
    } else {
      hash_file(data, algorithm)
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

export function open_read(path: fs.PathLike) {
  return fs.createReadStream(path);
}

export function open_write(path: fs.PathLike) {
  return fs.createWriteStream(path);
}

async function hash_buffer(buffer: Buffer, algorithm: string) {
  return await new Promise<string>((resolve) => {
    const hash = crypto.createHash(algorithm);
    hash.update(buffer);
    resolve(hash.digest("hex"));
  });
}

async function hash_file(path: fs.PathLike, algorithm: string) {
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export interface FileSystemObjectModel {
  readonly name: string;
  readonly type: PathType;
  readonly size: number;
  readonly path: string;
  readonly parent: string;
  readonly lastModified: Date;
  readonly created: Date;
}

export async function enum_path(
  pathname: string
): Promise<FileSystemObjectModel[]> {
  const stat = await stat_of(pathname);

  if (!stat.isDirectory()) return Promise.resolve([]);
  const parent = path.dirname(pathname.toString());
  return new Promise((resolve) => {
    fs.readdir(pathname, { withFileTypes: true }, async (err, files) => {
      if (err) {
        resolve([]);
      } else {
        const children: FileSystemObjectModel[] = [];
        for (const file of files) {
          if (!file.isFile() && !file.isDirectory()) continue; // skip unknown file types

          const type = file.isDirectory() ? PathType.DIR : PathType.FILE;
          const stat = await stat_of(file.path);
          const size = type === PathType.DIR ? -1 : stat.size;

          const fso: FileSystemObjectModel = {
            name: file.name,
            type,
            size,
            path: file.path,
            parent,
            lastModified: stat.mtime,
            created: stat.ctime,
          };

          children.push(fso);
        }
        resolve(children);
      }
    });
  });
}

export async function query_roots(): Promise<FileSystemObjectModel[]> {
  if (os.platform() !== "win32") return Promise.resolve([]); // not supported on non-windows platforms

  return new Promise((resolve, reject) => {
    exec("wmic logicaldisk get caption", async (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        const roots: FileSystemObjectModel[] = [];

        const lines = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        for (const line of lines) {
          const stat = await stat_of(line);

          const fso: FileSystemObjectModel = {
            name: line,
            type: PathType.DIR,
            size: -1,
            path: line,
            parent: ".",
            lastModified: stat.mtime,
            created: stat.ctime,
          };

          roots.push(fso);
        }
        resolve(roots);
      }
    });
  });
}
