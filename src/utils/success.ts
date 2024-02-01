import { Response } from "express";

export function success(res: Response, data: any) {
  res.status(200).json({
    success: true,
    code: 1,
    message: "success",
    data,
  });
}

export function fail(res: Response, message: string, code: number = 0) {
  res.status(200).json({
    success: false,
    code,
    message,
  });
}

export function badRequest(res: Response, msg?: string) {
  res.status(400).json({
    success: false,
    code: 0,
    message: msg || "bad request",
  });
}

export function internalError(res: Response, msg?: string) {
  res.status(500).json({
    success: false,
    code: 0,
    message: msg || "internal error",
  });
}

export function unauthorized(res: Response) {
  res.status(401).json({
    success: false,
    code: 0,
    message: "unauthorized",
  });
}

export function accessDenied(res: Response) {
  res.status(403).json({
    success: false,
    code: 0,
    message: "access denied",
  });
}

export function notFound(res: Response) {
  res.status(404).json({
    success: false,
    code: 0,
    message: "not found",
  });
}
