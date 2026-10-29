/** The methods of safeOwnerApproval the UI can call, see callSafeOwnerApprovalMethod */
export type SafeOwnerApprovalUiMethod =
  | 'update'
  | 'updateStatus'
  | 'dismissGasFeeChangedConfirmation'
  | 'enableErc4337AndReestimate'
  | 'retry'
  | 'cancelSignReq'

/** How waiting for a sent approval of a Safe smart account owner ended */
export type SafeOwnerApprovalResult = {
  /** The Safe has the approval onchain */
  isApproved: boolean
  /** The approval transaction failed, so it will never be onchain */
  hasFailed: boolean
}
