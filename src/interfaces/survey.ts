import { ControllerInterface } from './controller'

export type ISurveyController = ControllerInterface<
  InstanceType<typeof import('../controllers/survey/survey').SurveyController>
>

export interface Survey {
  surveyId: string
  questions: {
    id: number
    questionPosition: number
    requirement?: {
      questionId: number
      responseId: number
    }
    text: string
    responseOptions: Array<{ text: string; id: number }> | null
    responseType: 'singleChoice' | 'openText'
  }[]
}

export type SurveyAnswers = {
  [questionId: number]: { questionPosition: number; answer: number | string }
}
