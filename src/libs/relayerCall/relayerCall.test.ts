import { describe, expect, test } from '@jest/globals'
import { relayerCall } from './relayerCall'

describe('relayerCall tests', () => {
  test('GET, pass no body,200', async () => {
    const relayerOptions = { url: 'https://httpstat.us' }
    const callFunc = relayerCall.bind(relayerOptions)
    const res = await callFunc('/200')

    expect(res).toEqual({ success: false, data: '200 OK', status: 200, message: 'no json in res' })
  })
  test('GET, pass no body,404', async () => {
    const relayerOptions = { url: 'https://httpstat.us' }
    const callFunc = relayerCall.bind(relayerOptions)
    const res = await callFunc('/404')

    expect(res).toEqual({
      success: false,
      data: '404 Not Found',
      status: 404,
      message: 'no json in res'
    })
  })
  test('GET, pass no body, get body', async () => {
    const relayerOptions = { url: 'https://jsonplaceholder.typicode.com' }
    const callFunc = relayerCall.bind(relayerOptions)
    const res = await callFunc('/posts/1')

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
    const relayerOptions = { url: 'https://jsonplaceholder.typicode.com' }
    const getPosts = relayerCall.bind(relayerOptions)
    const res = await getPosts('/posts', 'POST', body)
    expect(res).toHaveProperty('title', body.title)
    expect(res).toHaveProperty('body', body.body)
    expect(res).toHaveProperty('userId', body.userId)
    expect(res).toHaveProperty('status', 201)
  })
})
