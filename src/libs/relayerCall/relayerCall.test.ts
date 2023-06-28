import { describe, expect, test } from '@jest/globals'
import { relayerCallUncaught } from './relayerCall'

describe('relayerCallUncaught tests', () => {
  test('GET, pass no body,200', async () => {
    const res = await relayerCallUncaught('https://httpstat.us/200')

    expect(res).toEqual({ success: false, data: '200 OK', status: 200, message: 'no json in res' })
  })
  test('GET, pass no body,404', async () => {
    const res = await relayerCallUncaught('https://httpstat.us/404')

    expect(res).toEqual({
      success: false,
      data: '404 Not Found',
      status: 404,
      message: 'no json in res'
    })
  })
  test('GET, pass no body, get body', async () => {
    const res = await relayerCallUncaught('https://jsonplaceholder.typicode.com/posts/1')

    expect(res).toEqual({
      // should have success if from relayer
      //   success: true,
      ...{
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
    const res = await relayerCallUncaught(
      'https://jsonplaceholder.typicode.com/posts',
      'POST',
      body
    )
    expect(res).toHaveProperty('title', body.title)
    expect(res).toHaveProperty('body', body.body)
    expect(res).toHaveProperty('userId', body.userId)
    expect(res).toHaveProperty('status', 201)
  })
})
