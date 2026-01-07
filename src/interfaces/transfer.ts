import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { ControllerInterface } from './controller'
import { AddressStateOptional } from './domains'

export type ITransferController = ControllerInterface<
  InstanceType<typeof import('../controllers/transfer/transfer').TransferController>
>

export interface TransferUpdate {
  humanizerInfo?: HumanizerMeta
  selectedToken?: TokenResult
  amount?: string
  shouldSetMaxAmount?: boolean
  addressState?: AddressStateOptional
  isSWWarningAgreed?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  amountFieldMode?: 'token' | 'fiat'
}
