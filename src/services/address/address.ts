import { HumanizerInfoType } from '../../hooks/useConstants'

const isValidAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address)

const isKnownTokenOrContract = (humanizerInfo: HumanizerInfoType, address: string) => {
  if (humanizerInfo?.names && humanizerInfo?.abis) {
    const addressToLowerCase = address.toLowerCase()
    const tokensAddresses = Object.keys(humanizerInfo.tokens)
    const contractsAddresses = Object.keys(humanizerInfo.names)
    return (
      tokensAddresses.includes(addressToLowerCase) ||
      contractsAddresses.includes(addressToLowerCase)
    )
  }

  return false
}

export { isValidAddress, isKnownTokenOrContract }
