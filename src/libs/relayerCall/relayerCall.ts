import fetch, { Headers } from 'node-fetch'

export enum RequestMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS'
}

export async function relayerCall(
  url: string,
  method: RequestMethod = RequestMethod.GET,
  body: any = null,
  headers: any = null
): Promise<any> {
  if (!url) return { success: false, message: 'no path' }
  if (body && [RequestMethod.GET, RequestMethod.DELETE, RequestMethod.HEAD].includes(method))
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
  const success = res.status >= 200 && res.status < 300
  try {
    return { success, data: JSON.parse(text), status: res.status }
  } catch (e) {
    return { success, data: text, status: res.status }
  }
}

// relayerCall('https://httpstat.us/404', RequestMethod.GET).then(console.log)
// relayerCall('https://httpstat.us/200', RequestMethod.GET).then(console.log)
// relayerCall('https://jsonplaceholder.typicode.com/posts/1', RequestMethod.GET).then(console.log)
// relayerCall('https://jsonplaceholder.typicode.com/posts', RequestMethod.POST, {
//   title: 'foo',
//   body: 'bar',
//   userId: 1
// }).then(console.log)
