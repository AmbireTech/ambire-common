import { Calls, UserRequest } from '../../interfaces/userRequest'

export interface Call {
  to: string
  value: bigint
  data: string
  // if this call is associated with a particular user request
  // multiple calls can be associated with the same user request, for example
  // when a batching request is made
  fromUserRequestId?: UserRequest['id']
  id?: Calls['calls'][number]['id']
}
