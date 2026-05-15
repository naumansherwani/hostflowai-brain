import { randomUUID } from "crypto";

export interface ApiSuccess<T = unknown> {
  ok: true;
  data: T;
  error: null;
  trace_id: string;
}

export interface ApiError {
  ok: false;
  data: null;
  error: { code: string; message: string };
  trace_id: string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

export function ok<T>(data: T, traceId?: string): ApiSuccess<T> {
  return {
    ok: true,
    data,
    error: null,
    trace_id: traceId ?? randomUUID(),
  };
}

export function err(
  code: string,
  message: string,
  traceId?: string
): ApiError {
  return {
    ok: false,
    data: null,
    error: { code, message },
    trace_id: traceId ?? randomUUID(),
  };
}

export function success<T>(
  data: T,
  _message?: string,
  _ui_flags?: Record<string, unknown>
): ApiSuccess<T> {
  return ok(data);
}

export function failed(
  message: string,
  _data?: unknown,
  _ui_flags?: Record<string, unknown>
): ApiError {
  return err("REQUEST_FAILED", message);
}
