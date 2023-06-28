import fetch from 'node-fetch'

export async function relayerCall(
  url: string,
  method: string = 'GET',
  body: any = null,
  headers: any = null
): Promise<any> {
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
    return { success: false, message: 'bad method' }
  if (!url) return { success: false, message: 'no url' }
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
