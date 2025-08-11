import { ControllerInterface } from './controller'

export type IAddressBookController = ControllerInterface<
  InstanceType<typeof import('../controllers/addressBook/addressBook').AddressBookController>
>
