import { names, tokens } from '../../constants/humanizerInfo.json'

const isValidAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address)

const isKnownTokenOrContract = (address: string) => {
  const addressToLowerCase = address.toLowerCase()
  const tokensAddresses = Object.keys(tokens)
  const contractsAddresses = Object.keys(names)
  return (
    tokensAddresses.includes(addressToLowerCase) || contractsAddresses.includes(addressToLowerCase)
  )
}

export { isValidAddress, isKnownTokenOrContract }
