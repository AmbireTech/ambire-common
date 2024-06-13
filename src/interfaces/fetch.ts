// Re-use the global fetch type (type should be with the same footprint across all apps)
interface RequestInitWithCustomHeaders extends RequestInit {
  headers: HeadersInit & {
    'X-App-Source': string // the first 11 chars from the Keystore Uid
  }
}

export type Fetch = (input: RequestInfo, init?: RequestInitWithCustomHeaders) => Promise<Response>
