/* eslint-disable no-prototype-builtins */
import { Fetch } from '../../interfaces/fetch'
import { parse, stringify } from '../richJson/richJson'

class RelayerError extends Error {
  public input: any

  public output: any

  constructor(message: string, input: any, output: any) {
    super(message)
    this.input = input
    this.output = output
  }
}

export async function relayerCallUncaught(
  url: string,
  fetch: Fetch,
  method: string = 'GET',
  body: any = null,
  headers: any = null
) {
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
    return { success: false, message: 'bad method' }
  if (!url) return { success: false, message: 'no url or path' }
  if (body && ['GET', 'DELETE', 'HEAD'].includes(method))
    return { success: false, message: 'should not have a body' }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? stringify(body) : undefined
  })

  const text = await res.text()
  const isStatusOk = res.status < 300 && res.status >= 200
  try {
    const json = parse(text)
    if (!json.hasOwnProperty('success')) {
      return { success: isStatusOk, ...json, status: res.status }
    }
    return { ...json, success: json.success && isStatusOk, status: res.status }
  } catch (e) {
    return { success: false, data: text, status: res.status, message: 'no json in res' }
  }
}

export async function relayerCall(
  this: {
    url: string
    fetch: Fetch
  },
  path: string,
  method: string = 'GET',
  body: any = null,
  headers: any = null
): Promise<any> {
  const res = await relayerCallUncaught(this.url + path, this.fetch, method, body, headers)
  if (!res.success) {
    const firstError =
      res.errorState && res.errorState.length ? res.errorState[0].message : res.message
    throw new RelayerError(firstError, { url: this.url, path, method, body, headers }, { res })
  }
  return res
}
