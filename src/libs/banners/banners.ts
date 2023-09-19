import { Account } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { UserRequest } from '../../interfaces/userRequest'

export const getMessageBanners = ({
  userRequests,
  selectedAccount,
  onOpen,
  onReject
}: {
  userRequests: UserRequest[]
  selectedAccount: string | null
  onOpen: (id: number) => void
  onReject: (err: string, id: number) => void
}) => {
  const txnBanners: Banner[] = []

  if (!userRequests) return txnBanners

  userRequests.forEach((req: UserRequest) => {
    if (req.accountAddr !== selectedAccount) return

    if (req.action.kind === 'message' || req.action.kind === 'typedMessage') {
      txnBanners.push({
        id: req.id,
        topic: 'TRANSACTION',
        title: 'Message waiting to be signed',
        text: `Message type: ${req.action.kind === 'message' ? 'personal_sign' : 'typed_data'}`, // TODO:
        actions: [
          {
            label: 'Open',
            onPress: () => onOpen(req.id)
          },
          {
            label: 'Reject',
            onPress: () => onReject('User rejected the transaction request', req.id)
          }
        ]
      })
    }
  })

  return txnBanners
}

export const getAccountOpBannersForEOA = ({
  userRequests,
  accounts,
  selectedAccount,
  onOpen,
  onReject
}: {
  userRequests: UserRequest[]
  accounts: Account[]
  selectedAccount: string | null
  onOpen: (id: number) => void
  onReject: (err: string, id: number) => void
}): Banner[] => {
  if (!userRequests) return []

  const activeUserRequest: UserRequest | undefined = userRequests.find((req: UserRequest) => {
    if (req.accountAddr !== selectedAccount) return

    const account = accounts.find((acc) => acc.addr === req.accountAddr) || ({} as Account)
    if (req.action.kind === 'call' && !account?.creation) {
      return req
    }
  })

  if (!activeUserRequest) return []

  return [
    {
      id: activeUserRequest.id,
      topic: 'TRANSACTION',
      title: 'Transaction waiting to be signed',
      text: '', // TODO:
      actions: [
        {
          label: 'Open',
          onPress: () => onOpen(activeUserRequest.id)
        },
        {
          label: 'Reject',
          onPress: () => onReject('User rejected the transaction request', activeUserRequest.id)
        }
      ]
    } as Banner
  ]
}

export const getPendingAccountOpBannersForEOA = ({
  userRequests,
  accounts,
  selectedAccount
}: {
  userRequests: UserRequest[]
  accounts: Account[]
  selectedAccount: string | null
}): Banner[] => {
  if (!userRequests) return []

  const pendingUserRequests: UserRequest[] = userRequests.filter((req: UserRequest) => {
    if (req.accountAddr !== selectedAccount) return false

    const account = accounts.find((acc) => acc.addr === req.accountAddr) || ({} as Account)
    if (req.action.kind === 'call' && !account?.creation) {
      return true
    }

    return false
  })

  if (!pendingUserRequests.length) return []

  return [
    {
      id: new Date().getTime(),
      topic: 'TRANSACTION',
      title: `${pendingUserRequests.length - 1} More pending transactions are waiting to be signed`,
      text: '' // TODO:
    } as Banner
  ]
}

export const getAccountOpBannersForSmartAccount = ({
  userRequests,
  accounts,
  selectedAccount,
  onOpen,
  onReject
}: {
  userRequests: UserRequest[]
  accounts: Account[]
  selectedAccount: string | null
  onOpen: (id: number) => void
  onReject: (err: string, id: number) => void
}) => {
  const txnBanners: Banner[] = []

  if (!userRequests) return txnBanners

  const groupedRequests = userRequests.reduce((acc: any, userRequest: UserRequest) => {
    const key = `${userRequest.accountAddr}-${userRequest.networkId}`

    if (!acc[key]) {
      acc[key] = []
    }
    const account = accounts.find((a) => a.addr === userRequest.accountAddr) || ({} as Account)
    if (
      userRequest.action.kind === 'call' &&
      account.creation &&
      account.addr === selectedAccount
    ) {
      acc[key].push(userRequest)
    }

    return acc
  }, {})

  const groupedRequestsArray: UserRequest[][] = (
    (Object.values(groupedRequests || {}) || []) as UserRequest[][]
  ).filter((group: any) => group.length)

  groupedRequestsArray.forEach((group) => {
    txnBanners.push({
      id: new Date().getTime(),
      topic: 'TRANSACTION',
      title: `${group.length} Transactions waiting to be signed`,
      text: '', // TODO:
      actions: [
        {
          label: 'Open',
          onPress: () => onOpen(group[0].id)
        },
        {
          label: 'Reject',
          onPress: () => {
            group.forEach((req) => {
              onReject('User rejected the transaction request', req.id)
            })
          }
        }
      ]
    })
  })

  return txnBanners
}
