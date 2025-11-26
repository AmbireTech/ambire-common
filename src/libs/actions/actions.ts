export const getAccountOpFromAction = (
  accountOpActionId: AccountOpAction['id'],
  actions: Action[]
) => {
  const accountOpAction = actions.find((a) => a.id === accountOpActionId) as AccountOpAction
  if (!accountOpAction) return undefined
  return accountOpAction.accountOp
}

/** Type guard helper to check if an action is a DappRequestAction */
export const isDappRequestAction = (action?: Action | null): action is DappRequestAction =>
  action?.type === 'dappRequest'
