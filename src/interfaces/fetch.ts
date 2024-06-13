// Re-use the global fetch type (type should be with the same footprint across all apps)
interface RequestInitWithCustomHeaders extends RequestInit {
  headers: HeadersInit & {
    'x-app-source'?: string // the first 11 chars from the Keystore Uid
    'x-api-key'?: string // JJiffy Scan API key
  }
}

export type Fetch = (input: RequestInfo, init?: RequestInitWithCustomHeaders) => Promise<Response>
