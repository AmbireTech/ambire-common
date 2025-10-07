import { ControllerInterface } from './controller'

export type IAccountPickerController = ControllerInterface<
  InstanceType<typeof import('../controllers/accountPicker/accountPicker').AccountPickerController>
>
