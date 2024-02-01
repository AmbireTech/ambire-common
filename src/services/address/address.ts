import { HumanizerInfoType } from '../../../v1/hooks/useConstants'
import { FEE_COLLECTOR } from '../../consts/addresses'

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

export { isValidAddress, isHumanizerKnownTokenOrSmartContract }
