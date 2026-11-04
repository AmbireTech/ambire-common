import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { ControllerInterface } from './controller'
import { AddressStateOptional } from './domains'

export type ITransferController = ControllerInterface<
  InstanceType<typeof import('../controllers/transfer/transfer').TransferController>
>

/**
 * An NFT (ERC-721) picked for sending in the transfer form. While it is set, the form
 * sends this NFT instead of a token, so there is no amount to enter.
 */
export type TransferNft = {
  /** The address of the NFT collection (contract) */
  address: string
  chainId: bigint
  tokenId: bigint
  /** The name of the collection, used to show the user what is being sent */
  collectionName: string
}

export interface TransferUpdate {
  humanizerInfo?: HumanizerMeta
  /** Selecting a token switches the form out of NFT mode, if it was in it */
  selectedToken?: TokenResult
  amount?: string
  shouldSetMaxAmount?: boolean
  addressState?: AddressStateOptional
  isRecipientAddressUnknownAgreed?: boolean
  amountFieldMode?: 'token' | 'fiat'
  /** Seed id of a Privacy Pools account to send to instead of an address; null undoes it. */
  privacyPoolsRecipient?: string | null
}

export type AddressPoisoningMatch = {
  matchedAddress: string
  // Number of consecutive chars that matched from the left/right side of the address body.
  // We keep them separate because poisoning lookalikes are not always symmetric (e.g. 3-left, 6-right).
  matchedPrefixCharsCount: number
  matchedSuffixCharsCount: number
  // Number of positions where the address body differs. A very low count means a likely typo.
  differingCharsCount: number
}

export type AmountAdjustmentInfo = {
  feeAmount: string
  tokenSymbol: string
}
