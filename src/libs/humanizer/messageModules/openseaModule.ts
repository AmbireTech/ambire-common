import { isHexString, toUtf8String } from 'ethers'

import { HumanizerPlainTextMessageModule, HumanizerTypedMessageFunction } from '../interfaces'
import {
  ExpectedTypedData,
  getAction,
  getLabel,
  getToken,
  isExactTypedData,
  TypedDataField
} from '../utils'

/** Seaport `OfferItem` and `ConsiderationItem` share these fields */
const SEAPORT_ITEM_FIELDS: TypedDataField[] = [
  { name: 'itemType', type: 'uint8' },
  { name: 'token', type: 'address' },
  { name: 'identifierOrCriteria', type: 'uint256' },
  { name: 'startAmount', type: 'uint256' },
  { name: 'endAmount', type: 'uint256' }
]

/** A single Seaport order, as seaport-js signs it (`EIP_712_ORDER_TYPE`) */
const SEAPORT_ORDER_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'OrderComponents',
  types: {
    OrderComponents: [
      { name: 'offerer', type: 'address' },
      { name: 'zone', type: 'address' },
      { name: 'offer', type: 'OfferItem[]' },
      { name: 'consideration', type: 'ConsiderationItem[]' },
      { name: 'orderType', type: 'uint8' },
      { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'zoneHash', type: 'bytes32' },
      { name: 'salt', type: 'uint256' },
      { name: 'conduitKey', type: 'bytes32' },
      { name: 'counter', type: 'uint256' }
    ],
    OfferItem: SEAPORT_ITEM_FIELDS,
    ConsiderationItem: [...SEAPORT_ITEM_FIELDS, { name: 'recipient', type: 'address' }]
  }
}

const SEAPORT_ADDRESS = [
  '0x0000000000000068F116a894984e2DB1123eB395',

  '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',

  '0x00000000006c3852cbEf3e08E8dF289169EdE581',

  '0x00000000F9490004C11Cef243f5400493c00Ad63',

  '0x00e5F120f500006757E984F1DED400fc00370000',

  '0x0000f00000627D293Ab4Dfb40082001724dB006F'
]

/** Humanizes the OpenSea and OpenSea Pro log in and terms of service messages */
export const openseaLoginMessageModule: HumanizerPlainTextMessageModule = (message) => {
  if (typeof message.content.message === 'string') {
    let messageAsText: string = message.content.message
    if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
      try {
        messageAsText = toUtf8String(message.content.message)
      } catch (e) {
        console.log("open sea module: couldn't do toUtf8String on message")
        return null
      }
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
  return null
}

/**
 * Humanizes a single Seaport order (primary type `OrderComponents`). Other Seaport
 * primary types (e.g. `BulkOrder`) sign different fields, so they are not shown here.
 */
export const humanizeSeaportOrder: HumanizerTypedMessageFunction = (message) => {
  if (
    message.content.domain.name !== 'Seaport' ||
    message.content.domain.version !== '1.6' ||
    !SEAPORT_ADDRESS.includes(message.content.domain.verifyingContract || '') ||
    !isExactTypedData(message.content, SEAPORT_ORDER_TYPED_DATA)
  )
    return null

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
