import { ErrorHumanizerError } from '../../libs/errorHumanizer/types'

export const MAYAN_BRIDGE = 'mayan'

export const HUMANIZED_ERRORS: ErrorHumanizerError[] = [
  {
    reasons: ['could not find token'],
    message:
      'The token you are trying to swap is not supported by our service provider. Please select another token.'
  }
]
