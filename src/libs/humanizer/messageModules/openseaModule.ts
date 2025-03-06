import { isHexString, toUtf8String } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getLabel, getToken } from '../utils'

const SEAPORT_ADDRESS = [
  '0x0000000000000068F116a894984e2DB1123eB395',

  '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',

  '0x00000000006c3852cbEf3e08E8dF289169EdE581',

  '0x00000000F9490004C11Cef243f5400493c00Ad63',

  '0x00e5F120f500006757E984F1DED400fc00370000',

  '0x0000f00000627D293Ab4Dfb40082001724dB006F'
]

export const openseaMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind === 'message' && typeof message.content.message === 'string') {
    let messageAsText: string = message.content.message
    if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
      messageAsText = toUtf8String(message.content.message)
    }
    const OPENSEA_LOGIN_MESSAGE_PREFIX = 'Welcome to OpenSea!'
    if (
      messageAsText.includes(OPENSEA_LOGIN_MESSAGE_PREFIX) &&
      messageAsText.toLowerCase().includes(message.accountAddr.toLowerCase())
    ) {
      return {
        fullVisualization: [getAction('Log in'), getLabel('OpenSea', true)]
      }
    }
    const OPENSEA_PRO_LOGIN_MESSAGE_PREFIX = 'Sign in to OpenSea Pro'
    if (
      messageAsText.includes(OPENSEA_PRO_LOGIN_MESSAGE_PREFIX) &&
      messageAsText.toLowerCase().includes(message.accountAddr.toLowerCase())
    ) {
      return {
        fullVisualization: [getAction('Log in'), getLabel('OpenSea Pro', true)]
      }
    }
    const OPENSEA_TOS = 'OpenSea Terms of Service'

    if (
      messageAsText.includes(OPENSEA_TOS) &&
      messageAsText.toLowerCase().includes(message.accountAddr.toLowerCase())
    ) {
      return {
        fullVisualization: [getAction('Accept'), getLabel('OpenSea Terms Terms of Service', true)]
      }
    }
  }
  if (message.content.kind === 'typedMessage') {
    if (
      message.content.domain.name === 'Seaport' &&
      message.content.domain.version === '1.6' &&
      SEAPORT_ADDRESS.includes(message.content.domain.verifyingContract || '')
    ) {
      const considerations = message.content.message.consideration
      const offer = message.content.message.offer

      const extractItems = ({ itemType, token, identifierOrCriteria, startAmount }: any) => {
        if (itemType === '0') return { address: token, amountOrId: BigInt(startAmount) }
        if (itemType === '1') return { address: token, amountOrId: BigInt(startAmount) }
        if (itemType === '2') return { address: token, amountOrId: BigInt(identifierOrCriteria) }
        if (itemType === '3') return { address: token, amountOrId: BigInt(identifierOrCriteria) }
        return null
      }
      const itemsToList = offer.map(extractItems).filter((x: any) => x)
      const itemsToGet = considerations
        .filter(({ recipient }: any) => recipient === message.accountAddr)
        .map(extractItems)
        .filter((x: any) => x)

      return {
        fullVisualization: [
          getAction('Make offer to swap'),
          ...itemsToList.map(({ address, amountOrId }: any) => getToken(address, amountOrId)),
          getLabel('for'),
          ...itemsToGet.map(({ address, amountOrId }: any) => getToken(address, amountOrId))
        ]
      }
    }
  }
  return { fullVisualization: [] }
}
