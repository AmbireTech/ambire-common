import { describe, expect, test } from '@jest/globals'
import { relayerCall } from './relayerCall'

describe('relayerCall tests', () => {
  test('POST, pass body, get body', async () => {
    const body = {
      title: 'foo',
      body: 'bar',
      userId: 1
    }

    const res = await relayerCall('https://jsonplaceholder.typicode.com/posts', 'POST', body)
    expect(res).toHaveProperty('title', body.title)
    expect(res).toHaveProperty('body', body.body)
    expect(res).toHaveProperty('userId', body.userId)
  })
})
