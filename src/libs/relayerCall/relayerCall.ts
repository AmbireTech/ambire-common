import { Fetch } from '../../interfaces/fetch'
/* eslint-disable no-prototype-builtins */
import { fetchWithTimeout } from '../../utils/fetch'
import { parse, stringify } from '../richJson/richJson'

export class RelayerError extends Error {
  public input: any

  public output: any

  public isHumanized = false

  constructor(message: string, input: any, output: any, isHumanized?: boolean) {
    super(message)
    this.input = input
    this.output = output
    this.isHumanized = !!isHumanized
  }
}
export const RELAYER_DOWN_MESSAGE =
  'Currently, the Ambire relayer seems to be temporarily down. Please try again a few moments later'

export async function relayerCallUncaught(
  url: string,
  fetch: Fetch,
  method: string = 'GET',
  body: any = null,
  headers: any = null,
  timeoutMs: number = 10000
) {
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
    return { success: false, message: 'bad method' }
  if (!url) return { success: false, message: 'no url or path' }
  if (body && ['GET', 'DELETE', 'HEAD'].includes(method))
    return { success: false, message: 'should not have a body' }

  const res = await fetchWithTimeout(
    fetch,
    url,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? stringify(body) : undefined
    },
    timeoutMs
  )

  const text = await res.text()
  const isStatusOk = res.status < 300 && res.status >= 200
  try {
    const json = parse(text)
    if (!json.hasOwnProperty('success')) {
      return { success: isStatusOk, ...json, status: res.status }
    }
    return { ...json, success: json.success && isStatusOk, status: res.status }
  } catch (e) {
    return {
      success: false,
      data: text,
      status: res.status,
      message: RELAYER_DOWN_MESSAGE
    }
  }
}

export type BindedRelayerCall = (
  path: string,
  method?: string,
  body?: any,
  headers?: any,
  timeoutMs?: number
) => Promise<any>

export async function relayerCall(
  this: {
    url: string
    fetch: Fetch
  },
  path: string,
  method: string = 'GET',
  body: any = null,
  headers: any = null,
  timeoutMs: number = 10000
): Promise<any> {
  console.log('Debug: relayerCall called with', {
    url: this.url,
    path,
    fetch: !!this.fetch
  })
  const res = await relayerCallUncaught(
    this.url + path,
    this.fetch,
    method,
    body,
    headers,
    timeoutMs
  )

  if (!res.success) {
    const firstError = res.errorState && res.errorState.length ? res.errorState[0] : res
    throw new RelayerError(
      firstError.message,
      { url: this.url, path, method, body, headers },
      { res },
      firstError?.isHumanized || false
    )
  }
  return res
}
