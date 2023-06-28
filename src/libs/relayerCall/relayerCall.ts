import fetch from 'node-fetch'

class RelayerError extends Error {
  public input: any

  public output: any

  constructor(message: string, input: any, output: any) {
    super(`relayer call error: ${message}`)
    this.input = input
    this.output = output
  }
}

export async function relayerCallUncaught(
  url: string,
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
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await res.text()

  try {
    const json = JSON.parse(text)
    return { ...json, status: res.status }
  } catch (e) {
    return { success: false, data: text, status: res.status, message: 'no json in res' }
  }
}

export async function relayerCall(
  this: { url: string },
  path: string,
  method: string = 'GET',
  body: any = null,
  headers: any = null
): Promise<any> {
  const res = await relayerCallUncaught(this.url + path, method, body, headers)
  if (!res.success)
    throw new RelayerError(res.message, { url: this.url, path, method, body, headers }, { res })
  return res
}

/*
    const resp = await this.fetch(`${this.relayerUrl}/v2/identity/${identity}`)
    const result: any = await resp.json()

    if (result.errType) throw new Error(`accountController: get account: ${result.errType}`)
    return result
*/
