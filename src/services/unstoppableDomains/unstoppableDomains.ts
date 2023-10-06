// @ts-nocheck
// TODO: add types
import { Resolution } from '@unstoppabledomains/resolution'

import { networks } from '../../consts/networks'

const resolution = new Resolution({
  sourceConfig: {
    uns: {
      locations: {
        Layer1: {
          url: networks.find((x) => x.id === 'ethereum')?.rpcUrl || '',
          network: 'mainnet'
        },
        Layer2: {
          url: networks.find((x) => x.id === 'polygon')?.rpcUrl || '',
          network: 'polygon-mainnet'
        }
      }
    }
  }
})

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

async function resolveUDomain(domain, currency, chain): string | null {
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
