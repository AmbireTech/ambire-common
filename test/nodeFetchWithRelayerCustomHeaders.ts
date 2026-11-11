import {
  createFetchWithRelayerCustomHeaders,
  parseRelayerCustomHeaders
} from './helpers/relayerCustomHeaders'
import { relayerUrl } from './relayerUrls'

// Stands in for `node-fetch` (see jest.config.js), because many tests pass it straight to
// the code under test and so never reach the global fetch. The full path skips that mapping.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFetch = require('node-fetch/lib/index.js')

const headers = parseRelayerCustomHeaders(process.env.RELAYER_CUSTOM_HEADERS)

const fetchWithHeaders = Object.keys(headers).length
  ? Object.assign(createFetchWithRelayerCustomHeaders(nodeFetch, headers, relayerUrl), nodeFetch)
  : nodeFetch

fetchWithHeaders.default = fetchWithHeaders

module.exports = fetchWithHeaders
