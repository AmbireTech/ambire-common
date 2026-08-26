import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { decodeGeneralAdapterCall } from './generalAdapter'

// Handles a single Morpho GeneralAdapter action call (repay, withdrawCollateral,
// supplyCollateral, borrow, flashLoan, the ERC-4626 vault actions, PublicAllocator
// reallocateTo, and the wrapped ERC-20 transfers) on its own, decoding it with the same
// logic Bundler3MulticallModule uses for each entry of a multicall bundle. This lets these
// calls be recognized even when they are not wrapped in a `multicall` - e.g. when the
// ERC-7730 humanizer decodes one of them individually as a nested calldata row, since
// Morpho has not published an ERC-7730 descriptor for the GeneralAdapter contract itself.
const Bundler3GeneralAdapterModule: HumanizerCallModule = (
  accOp: AccountOp,
  call: IrCall
): IrCall => decodeGeneralAdapterCall(accOp.accountAddr, call)

export default Bundler3GeneralAdapterModule
