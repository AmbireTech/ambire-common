import { HeadersInit, RequestInfo, RequestInit, Response } from 'node-fetch'

// TODO: One sunny day, consider adding specific types for the incoming responses
export interface CustomResponse extends Response {
  [key: string]: any
}

// Re-use the global fetch type (type should be with the same footprint across all apps)
export interface RequestInitWithCustomHeaders extends RequestInit {
  headers: HeadersInit & {
    'x-app-source'?: string // used internally to identify the source of the request
    'x-api-key'?: string // Jiffy Scan API key
    'x-lifi-api-key'?: string // Lifi API key
  }
}

export type Fetch = (
  input: RequestInfo,
  init?: RequestInitWithCustomHeaders
) => Promise<CustomResponse>
