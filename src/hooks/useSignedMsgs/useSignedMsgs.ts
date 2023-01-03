import { useCallback } from 'react'

import { UseSignedMsgsProps, UseSignedMsgsReturnType } from './types'

const useSignedMsgs = ({ useStorage }: UseSignedMsgsProps): UseSignedMsgsReturnType => {
  const [signedMessages, setSignedMessages] = useStorage<any>({
    key: 'signedMessages',
    defaultValue: []
  })

  const addSignedMessage = useCallback(
    (msg) => {
      setSignedMessages([...signedMessages, msg])
    },
    [setSignedMessages, signedMessages]
  )

  return {
    addSignedMessage,
    signedMessages
  }
}

export default useSignedMsgs
