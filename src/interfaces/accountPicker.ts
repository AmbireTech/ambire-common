import { ControllerInterface } from './controller'

export type IAccountPickerController = ControllerInterface<
  InstanceType<typeof import('../controllers/accountPicker/accountPicker').AccountPickerController>
>

export type AmbireRelayerIdentityCreateMultipleResponse = {
  success: boolean
  body: {
    identity: string
    status: {
      created: boolean
      reason?: string
    }
  }[]
}
