import { getAddress, Hex, isAddress, isHex, zeroAddress } from 'viem'

import {
  HumanizerErc7730Row,
  HumanizerMeta,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from './interfaces'

export type HexIrCall = IrCall & { data: Hex }

/** Type guard that narrows an IrCall to one with a valid hex data field. */
export function isHexCall(call: IrCall): call is HexIrCall {
  return isHex(call.data)
}

export function getWarning(
  content: string,
  code: HumanizerWarning['code'],
  blocking?: boolean,
  address?: string
): HumanizerWarning {
  return { content, blocking, code, address }
}

/**
 * Removes repeated warnings, keeping the first of each kind. Warnings for the same call can come
 * from more than one source (a humanizer module and an ERC-7730 descriptor), so the same concern
 * can be reported twice. Two warnings are the same only when their code, text and address all
 * match - warnings that share a code but say different things are all kept.
 */
export const dedupeWarnings = (warnings: HumanizerWarning[]): HumanizerWarning[] => {
  const warningKeys = new Set<string>()

  return warnings.filter((warning) => {
    const warningKey = `${warning.code}:${warning.content}:${warning.address || ''}`
    if (warningKeys.has(warningKey)) return false
    warningKeys.add(warningKey)

    return true
  })
}

/**
 * Adds warnings to the ones a call already carries, without repeating any. Modules run one after
 * another over the same call, so a module must never replace what an earlier one found. Returns
 * undefined when there is nothing to report, so calls without warnings keep their original shape.
 */
export const mergeWarnings = (
  existingWarnings: HumanizerWarning[] | undefined,
  addedWarnings: HumanizerWarning[]
): HumanizerWarning[] | undefined => {
  if (!existingWarnings?.length && !addedWarnings.length) return undefined

  return dedupeWarnings([...(existingWarnings || []), ...addedWarnings])
}

/**
 * Marks an approval that has no spending limit. `SignAccountOpController` removes warnings with
 * this code when the app that made the request is in the default Ambire catalog, so every module
 * that reports an unlimited approval must use this exact code.
 */
export const UNLIMITED_APPROVAL_WARNING_CODE = 'UNLIMITED_APPROVAL'

const MAX_AMOUNT_BY_BITS: { [bits: number]: bigint } = {
  256: 2n ** 256n - 1n,
  160: 2n ** 160n - 1n
}

/**
 * True when the amount is the largest value its type can hold. Contracts use this value to mean
 * "no limit". Only the exact maximum counts, so a large but finite approval is not reported.
 */
export const isUnlimitedAmount = (amount: bigint, bits: 256 | 160 = 256): boolean =>
  amount === MAX_AMOUNT_BY_BITS[bits]

/**
 * Warns that an approval lets the spender take any amount of the token, with no limit. The address
 * is lowercased to match `getAddressVisualization`, so both spellings of it compare as equal.
 */
export const getUnlimitedApprovalWarning = (spender: string): HumanizerWarning =>
  getWarning(
    'This app can spend this token from your account with no limit. Continue only if you trust it.',
    UNLIMITED_APPROVAL_WARNING_CODE,
    false,
    spender.toLowerCase()
  )

export const randomId = (): number => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

export function getLabel(
  content: string | bigint | number,
  isBold?: boolean
): HumanizerVisualization {
  return { type: 'label', content: content.toString(), id: randomId(), isBold }
}
export function getAction(
  content: string,
  options?: { warning?: boolean }
): HumanizerVisualization {
  return { type: 'action', content, id: randomId(), warning: options?.warning }
}
export function getImage(content: string): HumanizerVisualization {
  return { type: 'image', content, id: randomId() }
}
export function getBreak(): HumanizerVisualization {
  return { type: 'break', id: randomId() }
}

export function getAddressVisualization(_address: string): HumanizerVisualization {
  const address = _address.toLowerCase()
  return { type: 'address', address, id: randomId() }
}

export function getToken(
  _address: string,
  amount: bigint,
  chainId?: bigint
): HumanizerVisualization {
  const address = _address.toLowerCase()
  return {
    type: 'token',
    address,
    value: BigInt(amount),
    id: randomId(),
    chainId
  }
}
export function getTokenWithChain(
  address: string,
  amount: bigint,
  chainId?: bigint
): HumanizerVisualization {
  return getToken(address, amount, chainId)
}

export function getChain(chainId: bigint): HumanizerVisualization {
  return { type: 'chain', id: randomId(), chainId }
}

export function getText(text: string, mlMi?: boolean): HumanizerVisualization {
  return { type: 'text', content: text, id: randomId(), mlMi }
}

export function getErc7730Visualization(
  title: string | undefined,
  rows: HumanizerErc7730Row[],
  dapp?: IrCall['dapp'],
  titleParts?: HumanizerVisualization[]
): HumanizerVisualization {
  return { type: 'erc7730', title, titleParts, dapp, rows, id: randomId() }
}

// Wraps a plain, flat fullVisualization array (e.g. from a local humanizer module) so it can
// be embedded as a nested call's value without being reshaped into HumanizerErc7730Visualization's
// title/rows structure - the UI renders it inline with the same simple layout as a top-level
// call instead of the nested ERC-7730 row/chevron treatment, which implies a verified descriptor
// match that a local module fallback isn't.
export function getFlatVisualization(items: HumanizerVisualization[]): HumanizerVisualization {
  return { type: 'flatVisualization', items, id: randomId() }
}

export function flattenHumanizerVisualizations(
  visualizations: HumanizerVisualization[] = []
): HumanizerVisualization[] {
  return visualizations.flatMap((visualization) => {
    if (visualization.type !== 'erc7730') return [visualization]

    return [
      visualization,
      ...flattenHumanizerVisualizations(visualization.rows.flatMap((row) => row.value))
    ]
  })
}

export function hasErc7730Humanization(humanization?: IrCall[]): boolean {
  return !!humanization?.some((call) =>
    flattenHumanizerVisualizations(call.fullVisualization).some(
      (visualization) => visualization.type === 'erc7730'
    )
  )
}

export function getOnBehalfOf(onBehalfOf: string, sender: string): HumanizerVisualization[] {
  return onBehalfOf.toLowerCase() !== sender.toLowerCase()
    ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
    : []
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
export function getRecipientText(from: string, recipient: string): HumanizerVisualization[] {
  return from.toLowerCase() === recipient.toLowerCase()
    ? []
    : [getLabel('and send it to'), getAddressVisualization(recipient)]
}

export function getDeadlineText(deadline: bigint): string {
  const minute = 60000n
  const diff = BigInt(deadline) - BigInt(Date.now())

  if (diff < 0 && diff > -minute * 2n) return 'expired just now'
  if (diff < 0) return 'already expired'
  if (diff < minute) return 'expires in less than a minute'
  if (diff < 30n * minute) return `expires in ${Math.floor(Number(diff / minute))} minutes`
  if ((deadline / 1000n).toString(16) === 'f'.repeat(64)) return 'No expiration date'
  if (deadline.toString(16) === 'f'.repeat(64)) return 'No expiration date'
  const deadlineDate = new Date(Number(deadline))
  if (isNaN(deadlineDate.getTime())) return 'Invalid expiration date'

  return `valid until ${deadlineDate.toLocaleString()}`
}

export function getDeadline(deadlineSecs: bigint | number): HumanizerVisualization {
  const deadline = BigInt(deadlineSecs) * 1000n
  return {
    type: 'deadline',
    value: deadline,
    id: randomId()
  }
}
export function getLink(url: string, content: string): HumanizerVisualization {
  return { type: 'link', url, content, id: randomId() }
}

export function getWrapping(address: string, amount: bigint): HumanizerVisualization[] {
  return [getAction('Wrap'), getToken(address, amount)]
}

export function getUnwrapping(address: string, amount: bigint): HumanizerVisualization[] {
  return [getAction('Unwrap'), getToken(address, amount)]
}

// @TODO cant this be used in the <Address component>
export function getKnownName(
  humanizerMeta: HumanizerMeta | undefined,
  address: string
): string | undefined {
  if (!isAddress(address)) return
  return humanizerMeta?.knownAddresses?.[getAddress(address)]?.name
}

// Looks up a 4-byte function selector across every known ABI (not just the ABI of the call's
// target contract), since humanizerMeta has no reverse index from contract address to ABI name.
export function getKnownFunctionName(
  humanizerMeta: HumanizerMeta | undefined,
  selector: string
): string | undefined {
  const normalizedSelector = selector.toLowerCase()
  const matchingFragment = Object.values(humanizerMeta?.abis || {})
    .map((abi) => abi[normalizedSelector])
    .find((fragment) => fragment?.type === 'function')

  const signaturePrefix = 'function '
  const functionSignature = matchingFragment?.signature.startsWith(signaturePrefix)
    ? matchingFragment.signature.slice(signaturePrefix.length)
    : undefined
  const functionNameEnd = functionSignature?.indexOf('(') ?? -1

  return functionNameEnd >= 0 ? functionSignature?.slice(0, functionNameEnd).trim() : undefined
}

export const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} }

export const uintToAddress = (uint: bigint): string =>
  `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`

export const eToNative = (address: string): string =>
  address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? zeroAddress : address
