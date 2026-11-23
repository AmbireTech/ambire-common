import { hexlify, toUtf8Bytes } from 'ethers'

import { humanizeMessage } from '../index'
import { compareVisualizations } from '../testHelpers'
import { getAction, getText } from '../utils'
import {
  HASH_MESSAGE_TITLE,
  HASH_MESSAGE_WARNING_CODE,
  hashMessageModule
} from './hashMessageModule'

// a real Safe{WALLET} transaction hash - signing it with `personal_sign` approves that transaction
const SAFE_TX_HASH = '0xfe52d33ef333f05203d9eb0a0c4529dfb742aa1466dd3eb85cc6539dbc94c690'

const buildPlainMessage = (messageHex: string): Parameters<typeof hashMessageModule>[0] => ({
  fromRequestId: 1,
  accountAddr: '0x6969174FD72466430a46e18234D0b530c9FD5f49',
  chainId: 1n,
  signature: null,
  content: { kind: 'message', message: messageHex as `0x${string}` }
})

const hasHashWarning = (warnings?: { code: string }[]) =>
  !!warnings?.some((warning) => warning.code === HASH_MESSAGE_WARNING_CODE)

describe('hashMessageModule', () => {
  test('describes a 32-byte message as unverifiable and warns about it', () => {
    const result = hashMessageModule(buildPlainMessage(SAFE_TX_HASH))

    compareVisualizations(result?.fullVisualization || [], [
      getAction(HASH_MESSAGE_TITLE),
      getText(SAFE_TX_HASH)
    ])
    expect(hasHashWarning(result?.warnings)).toBe(true)
    // signing stays possible, e.g. for owners Safe{WALLET} itself asks to approve this way
    expect(result?.warnings?.some((warning) => warning.blocking)).toBe(false)
  })

  test('warns about a 32-byte message in upper-case hex', () => {
    const upperCaseHash = `0x${SAFE_TX_HASH.slice(2).toUpperCase()}`

    expect(hasHashWarning(hashMessageModule(buildPlainMessage(upperCaseHash))?.warnings)).toBe(true)
  })

  // a transaction hash can be made to read as text by trying many versions of the transaction,
  // so reading as text must not be enough to skip the warning
  test('warns about a 32-byte message even when it reads as text', () => {
    const textHex = hexlify(toUtf8Bytes('Sign in to Example at 12:00 UTC!'))
    expect(textHex.length).toBe(66)

    expect(hasHashWarning(hashMessageModule(buildPlainMessage(textHex))?.warnings)).toBe(true)
  })

  test.each([
    ['31 bytes', SAFE_TX_HASH.slice(0, -2)],
    ['33 bytes', `${SAFE_TX_HASH}00`],
    ['an empty message', '0x'],
    ['a regular text message', hexlify(toUtf8Bytes('Welcome! Sign this message to log in.'))]
  ])('returns null for %s, so the other plain text modules still run', (_, messageHex) => {
    expect(hashMessageModule(buildPlainMessage(messageHex))).toBeNull()
  })
})

describe('humanizeMessage with a 32-byte message', () => {
  test('shows that the message cannot be verified and its warning', () => {
    const irMessage = humanizeMessage(buildPlainMessage(SAFE_TX_HASH))

    expect(irMessage.fullVisualization?.[0]?.content).toBe(HASH_MESSAGE_TITLE)
    expect(hasHashWarning(irMessage.warnings)).toBe(true)
  })

  test('a 32-byte text message is not shown as a harmless message', () => {
    const textHex = hexlify(toUtf8Bytes('Sign in to Example at 12:00 UTC!'))
    const irMessage = humanizeMessage(buildPlainMessage(textHex))

    expect(irMessage.fullVisualization?.[0]?.content).toBe(HASH_MESSAGE_TITLE)
    expect(hasHashWarning(irMessage.warnings)).toBe(true)
  })

  test('a regular text message gets no hash warning', () => {
    const irMessage = humanizeMessage(buildPlainMessage(hexlify(toUtf8Bytes('Sign in to Example'))))

    expect(hasHashWarning(irMessage.warnings)).toBe(false)
  })

  test('a regular short text message is still shown by the other plain text modules', () => {
    const irMessage = humanizeMessage(buildPlainMessage(hexlify(toUtf8Bytes('Sign in to Example'))))

    expect(irMessage.fullVisualization?.[0]?.content).toBe('Message: ')
  })

  test('a typed message that holds a 32-byte hash does not use the plain text hash warning', () => {
    const irMessage = humanizeMessage({
      ...buildPlainMessage(SAFE_TX_HASH),
      content: {
        kind: 'typedMessage',
        domain: { chainId: 1 },
        types: { Hash: [{ name: 'hash', type: 'bytes32' }] },
        message: { hash: SAFE_TX_HASH },
        primaryType: 'Hash'
      }
    })

    expect(hasHashWarning(irMessage.warnings)).toBe(false)
  })
})
