import fetch, { Headers } from 'node-fetch'

export async function relayerCall(
  url: string,
  method: string = 'GET',
  body: any = null,
  headers: any = null
): Promise<any> {
  if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
    return { success: false, message: 'bad method' }
  if (!url) return { success: false, data: 'no path' }
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

  const okStatus = res.status >= 200 && res.status < 300
  try {
    const json = JSON.parse(text)
    const success = okStatus && json.success === true
    return { success, data: JSON.parse(text), status: res.status }
  } catch (e) {
    return { success: okStatus, data: text, status: res.status }
  }
}
