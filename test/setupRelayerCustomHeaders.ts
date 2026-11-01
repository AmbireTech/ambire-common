import {
  createFetchWithRelayerCustomHeaders,
  parseRelayerCustomHeaders
} from './helpers/relayerCustomHeaders'
import { relayerUrl } from './relayerUrls'

// Lets the tests reach a relayer that asks for extra headers. Runs before every
// test file, so the fetch the tests pick up from the global scope already has them.
const headers = parseRelayerCustomHeaders(process.env.RELAYER_CUSTOM_HEADERS)

if (Object.keys(headers).length) {
  global.fetch = createFetchWithRelayerCustomHeaders(fetch, headers, relayerUrl)
}
