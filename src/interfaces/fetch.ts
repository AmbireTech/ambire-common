// Re-use the global fetch type (type should be with the same footprint across all apps)
export interface RequestInitWithCustomHeaders extends RequestInit {
  headers: HeadersInit & {
    'x-app-source'?: string // used internally to identify the source of the request
    'x-api-key'?: string // Jiffy Scan API key
  }
}

export type Fetch = (input: RequestInfo, init?: RequestInitWithCustomHeaders) => Promise<Response>
