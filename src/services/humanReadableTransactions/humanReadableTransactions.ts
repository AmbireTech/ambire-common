// TODO: add types
// @ts-nocheck

import { constants } from 'ethers'
import { formatUnits } from 'ethers/lib/utils'

import { HumanizerInfoType } from '../../hooks/useConstants'

// address (lowercase) => name
const knownAliases = {}
// address (lowercase) => [symbol, decimals]
const knownTokens = {}
// address (lowercase) => name
const knownAddressNames = {}

export const formatNativeTokenAddress = (address) =>
  address.toLowerCase() === `0x${'e'.repeat(40)}` ? `0x${'0'.repeat(40)}` : address.toLowerCase()

// Currently takes network because one day we may be seeing the same addresses used on different networks
export function getName(humanizerInfo: HumanizerInfoType, addr, network) {
  const address = addr.toLowerCase()
  return (
    humanizerInfo.names[address] ||
    (humanizerInfo.tokens[address] ? `${humanizerInfo.tokens[address][0]} token` : null) ||
    knownAliases[address] ||
    knownAddressNames[address] ||
    addr
  )
}

export function token(humanizerInfo: HumanizerInfoType, addr, amount, extended = false) {
  const address = addr.toLowerCase()
  const assetInfo = humanizerInfo.tokens[address] || knownTokens[address]
  if (assetInfo) {
    const extendedToken = {
      address,
      symbol: assetInfo[0],
      decimals: assetInfo[1],
      amount: null
    }

    if (!amount) return !extended ? assetInfo[0] : extendedToken

    if (constants.MaxUint256.eq(amount))
      return !extended
        ? `maximum ${assetInfo[0]}`
        : {
            ...extendedToken,
            amount: -1
          }

    return !extended
      ? `${formatUnits(amount, assetInfo[1])} ${assetInfo[0]}`
      : {
          ...extendedToken,
          amount: formatUnits(amount, assetInfo[1])
        }
  }
  return !extended
    ? `${formatUnits(amount, 0)} units of unknown token`
    : {
        address,
        symbol: null,
        decimals: null,
        amount: formatUnits(amount, 0)
      }
}

export function nativeToken(network, amount, extended = false) {
  const extendedNativeToken = {
    address: `0x${'0'.repeat(40)}`,
    symbol: 'unknown native token',
    decimals: 18
  }

  // All EVM chains use a 18 decimal native asset
  if (network) {
    return !extended
      ? `${formatUnits(amount, 18)} ${network.nativeAssetSymbol}`
      : {
          ...extendedNativeToken,
          symbol: network.nativeAssetSymbol,
          amount: formatUnits(amount, 18)
        }
  }
  return !extended
    ? `${formatUnits(amount, 18)} unknown native token`
    : {
        ...extendedNativeToken,
        amount: formatUnits(amount, 18)
      }
}

export function setKnownAddressNames(uDomains) {
  uDomains.forEach(
    // eslint-disable-next-line no-return-assign
    ({ address, addressLabel }) => (knownAddressNames[address.toLowerCase()] = addressLabel)
  )
}

export function setKnownAddresses(addrs) {
  // eslint-disable-next-line no-return-assign
  addrs.forEach(({ address, name }) => (knownAliases[address.toLowerCase()] = name))
}

// eslint-disable-next-line @typescript-eslint/no-shadow
export function setKnownTokens(tokens) {
  tokens.forEach(
    // eslint-disable-next-line no-return-assign
    ({ address, symbol, decimals }) => (knownTokens[address.toLowerCase()] = [symbol, decimals])
  )
}

export function isKnown(humanizerInfo: HumanizerInfoType, txn, from) {
  if (txn[0] === from) return true
  const address = txn[0].toLowerCase()
  return !!(
    knownAliases[address] ||
    humanizerInfo.names[address] ||
    humanizerInfo.tokens[address] ||
    knownTokens[address]
  )
}

export { knownAliases, knownTokens }
