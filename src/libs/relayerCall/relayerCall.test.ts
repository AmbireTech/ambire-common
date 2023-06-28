import { describe, expect, test } from '@jest/globals'
import { relayerCall, RequestMethod } from './relayerCall'

describe('relayerCall tests', () => {
  test('GET, pass no body,200', async () => {
    const res = await relayerCall('https://httpstat.us/200', RequestMethod.GET)
    expect(res).toEqual({ success: true, data: '200 OK', status: 200 })
  })
  test('GET, pass no body,404', async () => {
    const res = await relayerCall('https://httpstat.us/404', RequestMethod.GET)
    expect(res).toEqual({ success: false, data: '404 Not Found', status: 404 })
  })
  test('GET, pass no body, get body', async () => {
    const res = await relayerCall('https://jsonplaceholder.typicode.com/posts/1', RequestMethod.GET)
    expect(res).toEqual({
      success: true,
      data: {
        userId: 1,
        id: 1,
        title: 'sunt aut facere repellat provident occaecati excepturi optio reprehenderit',
        body: 'quia et suscipit\nsuscipit recusandae consequuntur expedita et cum\nreprehenderit molestiae ut ut quas totam\nnostrum rerum est autem sunt rem eveniet architecto'
      },
      status: 200
    })
  })
  test('POST, pass body, get body', async () => {
    const body = {
      title: 'foo',
      body: 'bar',
      userId: 1
    }

    const res = await relayerCall(
      'https://jsonplaceholder.typicode.com/posts',
      RequestMethod.POST,
      body
    )

    expect(res).toHaveProperty('success', true)
    expect(res).toHaveProperty('status', 201)
    expect(res.data).toHaveProperty('title', body.title)
    expect(res.data).toHaveProperty('body', body.body)
    expect(res.data).toHaveProperty('userId', body.userId)
  })
})
