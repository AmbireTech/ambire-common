import { AccountOp } from '../libs/accountOp/accountOp'
import { EstimateResult } from '../libs/estimate/interfaces'

const findAccountOpInSignAccountOpsToBeSigned = (
  accountOpsToBeSigned: {
    [key: string]: {
      [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
    }
  },
  accountAddr: string,
  networkId: string
): AccountOp | null => {
  let foundAccountOp = null

  Object.values(accountOpsToBeSigned).forEach((accountOpsToBeSignedByAccounts) => {
    Object.values(accountOpsToBeSignedByAccounts).forEach((accountOpsToBeSignedByNetwork) => {
      if (
        accountOpsToBeSignedByNetwork?.accountOp &&
        accountOpsToBeSignedByNetwork?.accountOp?.accountAddr === accountAddr &&
        accountOpsToBeSignedByNetwork?.accountOp?.networkId === networkId
      ) {
        foundAccountOp = accountOpsToBeSignedByNetwork.accountOp
      }
    })
  })

  return foundAccountOp
}

export default findAccountOpInSignAccountOpsToBeSigned
