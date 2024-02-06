import { BlockMap, MapTimeoutError } from "../model/BlockMap";
import { ControllerChannel } from "../model/ControllerChannel";
import * as fsys from "../utils/fsys";
import getNextRandomToken from "../utils/random";
import * as response from "../utils/success";

import { Router } from "express";

export enum FileOperationCommand {
  READ = "_read", // readdir
  HASH = "_hash", // hash file, need to specify an algorithm
  RM = "_rm", // remove file or directory (can be recursive)
  COPY = "_cp", // copy file(s) to clipboard, path(s) on clipboard will be overwritten
  PASTE = "_paste", // paste file(s) from clipboard
  RENAME = "_rename", // rename file
  GET = "_get", // read file
  PUT = "_put", // write file
  SHELL = "_shell", // execute file, must be executable
  MKDIR = "_mkdir", // make directory
  GETINFO = "_info", // get file/dir detail info
}

export type FileOperationOptions = {
  overwrite?: boolean;
  recursive?: boolean;
  algorithm?: string;
};

export type FileOperationResult = {
  success: boolean;
  code: number;
  message: string;
  ticket: string;
};

export class FsoRouter {
  private readonly _router: Router;
  private readonly _contoller: ControllerChannel;
  private readonly _results: BlockMap<FileOperationResult>;

  constructor(clt: ControllerChannel) {
    this._contoller = clt;
    this._results = new BlockMap(1000);
    this._router = Router();
    this._router.use((req, res, next) => {
      if (req.method !== "POST") {
        response.methodNotAllowed(res);
        return;
      }

      const { path } = req.body as {
        path: string;
      };
      if (path) {
        req["_target"] = decodeURIComponent(path);
        next();
      } else {
        response.badRequest(res, "path is required");
      }
    });
    this.init();
  }

  public init() {
    this._router.post("/rpc/:cmd", async (req, res) => {
      const ticket = getNextRandomToken();
      const timeoutStr = req.query.timeout as string;
      const timeout = parseInt(timeoutStr) || 30000;

      const target = req["_target"] as string;
      const options = req.body as FileOperationOptions;

      this._contoller
        .callRemoteProc(
          {
            cmd: req.params.cmd as FileOperationCommand,
            data: {
              target,
              options,
            },
          },
          timeout // if timeout is set to <= 0, then it will never timeout
        )
        .then((ret) => {
          this._results.set(ticket, ret.data as FileOperationResult);
        })
        .catch((e) => {
          this._results.set(ticket, {
            success: false,
            code: 0,
            message: e.message,
            ticket,
          });
        });

      response.success(res, { ticket });
    });

    this._router.get("/result/:ticket", async (req, res) => {
      const ticket = req.params.ticket as string;
      const timeoutStr = req.query.timeout as string;
      const timeout = parseInt(timeoutStr) || 30000;
      try {
        const result = await this._results.get(ticket, timeout);

        if (result) {
          response.success(res, {
            fulfilled: true,
            result,
          });
        } else {
          response.fail(res, "no result");
        }
      } catch (e) {
        if (e instanceof MapTimeoutError) {
          response.success(res, {
            fulfilled: false,
          });
        } else {
          response.internalError(res, e.message);
        }
      }
    });
  }
}
