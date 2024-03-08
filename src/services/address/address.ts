import { HumanizerInfoType } from '../../hooks/useConstants'
import { FEE_COLLECTOR } from '../../consts/addresses'
// import { HumanizerInfoType } from '../../../v1/hooks/useConstants'

const isValidAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address)

const isHumanizerKnownTokenOrSmartContract = (
  humanizerInfo: HumanizerInfoType,
  _address: string
) => {
  const address = _address.toLowerCase() // humanizer keys (addresses) are lowercase

  // In order to humanize the fee collector as "Gas Tank", it is included in the
  // "names" in the humanizer (all others are smart contract addresses). But the
  // fee collector is not a smart contract (or token). It is an EOA.
  if (address === FEE_COLLECTOR.toLowerCase()) return false

  return (
    Object.keys(humanizerInfo.tokens).includes(address) || // token addresses
    Object.keys(humanizerInfo.names).includes(address) // smart contract addresses
  )
}
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

export { isValidAddress, isHumanizerKnownTokenOrSmartContract,isKnownTokenOrContract }
