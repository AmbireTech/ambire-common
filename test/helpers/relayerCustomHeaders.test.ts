import {
  createFetchWithRelayerCustomHeaders,
  parseRelayerCustomHeaders
} from './relayerCustomHeaders'

const RELAYER_URL = 'https://relayer.example.com'
const HEADERS = { 'x-test-header': 'secret-value' }

describe('createFetchWithRelayerCustomHeaders', () => {
  const baseFetch = jest.fn(() => Promise.resolve(new Response()))
  const fetchWithHeaders = createFetchWithRelayerCustomHeaders(baseFetch, HEADERS, RELAYER_URL)

  beforeEach(() => baseFetch.mockClear())

  it('adds the headers to a relayer request and keeps the ones of the caller', async () => {
    await fetchWithHeaders(`${RELAYER_URL}/gas-tank/assets`, { headers: { a: 'b' } })

    const sentHeaders = (baseFetch.mock.calls[0] as any)[1].headers as Headers
    expect(sentHeaders.get('x-test-header')).toBe('secret-value')
    expect(sentHeaders.get('a')).toBe('b')
  })

  it.each([
    `${RELAYER_URL}.evil.com/x`,
    'https://relayer.example.com@evil.com/x',
    'https://example.com/x'
  ])('does not add the headers to %s', async (url) => {
    await fetchWithHeaders(url)

    expect((baseFetch.mock.calls[0] as any)[1]).toBeUndefined()
  })
})

describe('parseRelayerCustomHeaders', () => {
  it('rejects a value that is not a JSON object with string values, without leaking it', () => {
    expect(() => parseRelayerCustomHeaders('x-test-header=secret-value')).toThrow(
      'RELAYER_CUSTOM_HEADERS must be a JSON object with string values'
    )
    expect(() => parseRelayerCustomHeaders('{"x-test-header":3}')).toThrow(
      'RELAYER_CUSTOM_HEADERS must be a JSON object with string values'
    )
  })
})
