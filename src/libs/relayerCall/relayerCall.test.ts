import { describe, expect, test } from '@jest/globals'
import { relayerCall } from './relayerCall'

interface RelayerOptions {
  url: string
}
describe('relayerCall tests', () => {
  test('POST, pass body, get body', async () => {
    const body = {
      title: 'foo',
      body: 'bar',
      userId: 1
    }
    const relayerOptions: RelayerOptions = { url: 'https://jsonplaceholder.typicode.com/' }
    const getPosts = relayerCall.bind(relayerOptions)

    const res = await getPosts('posts', 'POST', body)
    expect(res).toHaveProperty('title', body.title)
    expect(res).toHaveProperty('body', body.body)
    expect(res).toHaveProperty('userId', body.userId)
  })
})
