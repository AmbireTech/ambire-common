import { HumanizerVisualization, HumanizerWarning } from '../../interfaces'
import {
  RECIPIENT_LABEL,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken
} from '../../utils'
import { ConversionKind, Effect, Place, UniswapContext, isPassThroughPlace } from './effects'
import { Group, Outcome } from './ledger'

export const FUNDS_LEFT_IN_ROUTER_WARNING_CODE = 'UNISWAP_FUNDS_LEFT_IN_ROUTER'

export type UniswapSummary = {
  visualization: HumanizerVisualization[]
  warnings: HumanizerWarning[]
}

const joinWithAndLabel = (lines: HumanizerVisualization[][]): HumanizerVisualization[] =>
  lines
    .filter((line) => line.length)
    .reduce<HumanizerVisualization[]>((all, line) => [...all, ...line, getLabel('and')], [])
    .slice(0, -1)

const joinTokens = (tokens: string[]): HumanizerVisualization[] =>
  tokens.flatMap((token, index) => [...(index ? [getLabel('and')] : []), getToken(token, 0n)])

const getRecipientVisualization = (address: string): HumanizerVisualization[] => [
  getLabel(RECIPIENT_LABEL),
  getAddressVisualization(address)
]

const getAddressOfPlace = (place: Place): string | undefined =>
  place.kind === 'external' || place.kind === 'pool' ? place.address : undefined

const getConversionAction = (conversions: ConversionKind[]): string => {
  if (conversions.every((kind) => kind === 'wrap')) return 'Wrap'
  if (conversions.every((kind) => kind === 'unwrap')) return 'Unwrap'
  return 'Swap'
}

const getPermitLine = (effect: Effect): HumanizerVisualization[] =>
  effect.type === 'permit'
    ? [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(effect.token, effect.amount),
        getLabel('to'),
        getAddressVisualization(effect.spender)
      ]
    : []

const unique = <T>(items: T[]): T[] => [...new Set(items)]

/**
 * One group of flows is one operation for the user: it lists what the signer pays, and what is
 * received and by whom. It never says which of the tokens that are paid is used for which of the
 * tokens that are received, because the call does not say it.
 */
const renderGroup = (
  group: Group,
  deadline: bigint | undefined,
  routerAddr: string
): HumanizerVisualization[][] => {
  const lines = renderGroupOperation(group, deadline)
  if (lines.length || !group.userPaid.length) return lines

  // The tokens of the signer go to a place and nothing in the call takes them out. Without this
  // line, the summary would not say that they are paid.
  return group.holdingPlaces.flatMap(({ place, token }) => {
    const address = getAddressOfPlace(place)
    return [
      [
        getAction('Send'),
        getToken(token, 0n),
        getLabel('to'),
        getAddressVisualization(address ?? routerAddr)
      ]
    ]
  })
}

const renderGroupOperation = (
  group: Group,
  deadline: bigint | undefined
): HumanizerVisualization[][] => {
  const visibleTerminals = group.terminals.filter((terminal) => !terminal.isHidden)
  const externalTerminals = visibleTerminals.filter((terminal) => terminal.place.kind !== 'user')
  const externalAddresses = unique(
    externalTerminals.flatMap((terminal) => getAddressOfPlace(terminal.place) ?? [])
  )
  const sendLines = (): HumanizerVisualization[][] =>
    externalAddresses.flatMap((address) =>
      unique(
        externalTerminals
          .filter((terminal) => getAddressOfPlace(terminal.place) === address)
          .map((terminal) => terminal.token)
      ).map((token) => {
        const terminal = externalTerminals.find(
          (item) => getAddressOfPlace(item.place) === address && item.token === token
        )
        return [
          getAction('Send'),
          ...(terminal?.shareBips ? [getLabel(`${Number(terminal.shareBips) / 100}%`, true)] : []),
          getToken(token, 0n),
          getLabel('to'),
          getAddressVisualization(address)
        ]
      })
    )

  // tokens that were in the router before the call are not the funds of the signer
  if (!group.userPaid.length) return sendLines()

  // what returns to the signer is not received, it is the part that was not spent
  const userReceived = unique(
    visibleTerminals
      .filter((terminal) => terminal.place.kind === 'user')
      .map((terminal) => terminal.token)
      .filter((token) => !group.userPaid.includes(token))
  )

  const receivedTokens = unique([...userReceived, ...externalTerminals.map((t) => t.token)])
  // a wrap and an unwrap that give back the tokens that were paid are only a transfer
  const isOnlyATransfer =
    !group.conversions.includes('swap') &&
    receivedTokens.length > 0 &&
    receivedTokens.every((token) => group.userPaid.includes(token)) &&
    group.userPaid.every((token) => receivedTokens.includes(token))

  if (!group.conversions.length || isOnlyATransfer) {
    return [
      ...sendLines(),
      ...(externalAddresses.length || !userReceived.length
        ? []
        : userReceived.map((token) => [getAction('Withdraw'), getToken(token, 0n)]))
    ]
  }

  const action = getConversionAction(group.conversions)
  const lastConversion = [...group.flows].reverse().find((flow) => flow.conversion)
  const shownTokens =
    receivedTokens.length || !lastConversion ? receivedTokens : [lastConversion.tokenOut]

  const isRecipientInline = !userReceived.length && externalAddresses.length === 1
  const [onlyAddress] = externalAddresses

  // a wrap and an unwrap are written like a swap, so that both tokens are named
  const line: HumanizerVisualization[] = [
    getAction(action),
    ...joinTokens(group.userPaid),
    getLabel('for'),
    ...joinTokens(shownTokens)
  ]
  if (isRecipientInline && onlyAddress) line.push(...getRecipientVisualization(onlyAddress))
  if (action === 'Swap' && deadline !== undefined) line.push(getDeadline(deadline))

  return [line, ...(isRecipientInline ? [] : sendLines())]
}

/** The summary of a call whose every command is understood */
const renderCondensed = (
  outcome: Outcome,
  deadline: bigint | undefined,
  routerAddr: string
): HumanizerVisualization[][] => {
  const lines = [
    ...outcome.permits.map(getPermitLine),
    ...outcome.groups.flatMap((group) => renderGroup(group, deadline, routerAddr))
  ].filter((line) => line.length)
  if (lines.length) return lines

  // Tokens that the router already held and that go to the signer are not shown next to what the
  // signer pays. When there is nothing else to show (for example a call that only refunds the ETH
  // of the router), they are the whole call.
  return outcome.groups.flatMap((group) =>
    unique(
      group.terminals
        .filter((terminal) => terminal.place.kind === 'user' && !terminal.isHidden)
        .map((terminal) => terminal.token)
    ).map((token) => [getAction('Withdraw'), getToken(token, 0n)])
  )
}

/**
 * The summary of a call that has a command that is not understood. It can do anything with the
 * tokens, so nothing is shortened: every effect is listed.
 */
const renderListed = (outcome: Outcome, deadline: bigint | undefined, routerAddr: string) => {
  const flowOfEffect = new Map(outcome.flows.map((flow) => [flow.effectIndex, flow]))

  return outcome.effects.map((effect, index): HumanizerVisualization[] => {
    if (effect.type === 'permit') return getPermitLine(effect)
    if (effect.type === 'opaque') return effect.visualization || []
    if (flowOfEffect.get(index)?.isHiddenLeak) return []

    const recipientAddress = getAddressOfPlace(effect.to)
    const recipient = recipientAddress ? getRecipientVisualization(recipientAddress) : []

    if (effect.type === 'transfer') {
      // What the signer pays to a contract that passes tokens on, and what is moved to a pool. A
      // command that is not understood can do anything with it.
      if (effect.isCallValue) return []
      const isPayment = effect.from.kind === 'user' && isPassThroughPlace(effect.to)
      const isMoveToPool = isPassThroughPlace(effect.from) && effect.to.kind === 'pool'
      if (isPayment || isMoveToPool) {
        return [
          getAction('Send'),
          getToken(effect.token, effect.amount.kind === 'exact' ? effect.amount.value : 0n),
          getLabel('to'),
          effect.to.kind === 'v4'
            ? getLabel('Uniswap V4')
            : getAddressVisualization(getAddressOfPlace(effect.to) ?? routerAddr)
        ]
      }
      if (recipientAddress && effect.to.kind === 'external') {
        return [
          getAction('Send'),
          ...(effect.amount.kind === 'portion'
            ? [getLabel(`${Number(effect.amount.bips) / 100}%`, true)]
            : []),
          getToken(effect.token, 0n),
          getLabel('to'),
          getAddressVisualization(recipientAddress)
        ]
      }
      return effect.to.kind === 'user' && effect.from.kind !== 'external'
        ? [getAction('Withdraw'), getToken(effect.token, 0n)]
        : []
    }

    return [
      getAction(effect.kind === 'swap' ? 'Swap' : effect.kind === 'wrap' ? 'Wrap' : 'Unwrap'),
      getToken(effect.tokenIn, 0n),
      getLabel('for'),
      getToken(effect.tokenOut, 0n),
      ...recipient,
      ...(effect.kind === 'swap' && deadline !== undefined ? [getDeadline(deadline)] : [])
    ]
  })
}

export const renderOutcome = (
  outcome: Outcome,
  ctx: UniswapContext,
  deadline?: bigint
): UniswapSummary => {
  const lines = outcome.opaque.length
    ? renderListed(outcome, deadline, ctx.routerAddr)
    : renderCondensed(outcome, deadline, ctx.routerAddr)

  const warnings: HumanizerWarning[] = outcome.stranded.length
    ? [
        {
          code: FUNDS_LEFT_IN_ROUTER_WARNING_CODE,
          content:
            'Some of the tokens you send can stay in the Uniswap contract and not reach you. Anyone can take tokens that stay there.'
        }
      ]
    : []

  const visualization = joinWithAndLabel(lines)
  return {
    // a call that shows nothing is shown as a generic action, so that it is never empty
    visualization: visualization.length
      ? visualization
      : [getAction('Uniswap action'), getLabel('to'), getAddressVisualization(ctx.routerAddr)],
    warnings
  }
}
