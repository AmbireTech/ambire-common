// @ts-nocheck
// TODO: add types
import { Resolution } from '@unstoppabledomains/resolution'

const resolution = new Resolution()

function getMessage(e?: string) {
  if (e === 'UnregisteredDomain') return 'Domain is not registered'
  if (e === 'RecordNotFound') return 'Crypto record is not found (or empty)'
  if (e === 'UnspecifiedResolver') return 'Domain is not configured (empty resolver)'
  if (e === 'UnsupportedDomain') return 'Domain is not supported'
  return 'Domain is not registered'
}

async function resolveAddress(domain) {
  return resolution
    .addr(domain, 'ETH')
    .then((addr) => ({ success: true, address: addr }))
    .catch((e) => ({ success: false, code: e.code, message: getMessage(e.code) }))
}

async function resolveAddressMultiChain(domain, currency, chain) {
  return resolution
    .multiChainAddr(domain, currency, chain)
    .then((addr) => ({ success: true, address: addr }))
    .catch((e) => ({ success: false, code: e.code, message: getMessage(e.code) }))
}

async function resolveUDomain(domain, currency, chain) {
  const [nativeUDAddress, customUDAddress] = await Promise.all([
    resolveAddress(domain),
    resolveAddressMultiChain(domain, currency, chain)
  ])
  // eslint-disable-next-line no-nested-ternary
  return customUDAddress.success
    ? customUDAddress.address
    : nativeUDAddress.success
    ? nativeUDAddress.address
    : null
}

export { resolveUDomain }
