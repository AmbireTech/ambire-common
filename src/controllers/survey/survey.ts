import { BindedRelayerCall, relayerCall } from '@/libs/relayerCall/relayerCall'

import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { ISurveyController, Survey, SurveyFetchingStatus } from '../../interfaces/survey'
import EventEmitter from '../eventEmitter/eventEmitter'

// TODO: move
function isValidResponseOption(
  r: unknown
): r is NonNullable<Survey['questions'][number]['responseOptions']>[number] {
  return (
    !!r &&
    typeof r === 'object' &&
    'text' in r &&
    typeof r.text === 'string' &&
    'id' in r &&
    typeof r.id === 'number'
  )
}
// TODO: move
function isSurveyQuestion(q: unknown): Survey['questions'][number] | null {
  if (!q || typeof q !== 'object') return null
  if (!('id' in q) || typeof q.id !== 'number') return null
  if (!('questionPosition' in q) || typeof q.questionPosition !== 'number') return null
  if (!('text' in q) || typeof q.text !== 'string') return null
  if (!('responseType' in q) || typeof q.responseType !== 'string') return null

  let question: Survey['questions'][number] | undefined
  if (q.responseType === 'singleChoice') {
    if (!('responseOptions' in q) || !Array.isArray(q.responseOptions)) return null
    if (!q.responseOptions.every(isValidResponseOption)) return null
    question = {
      id: q.id,
      questionPosition: q.questionPosition,
      text: q.text,
      responseType: 'singleChoice',
      responseOptions: q.responseOptions
    }
  }
  if (q.responseType === 'openText')
    question = {
      id: q.id,
      questionPosition: q.questionPosition,
      text: q.text,
      responseType: 'openText',
      responseOptions: null
    }
  if (!question) return null
  return question
}
// TODO: move
function parseSurvey(res: unknown): { ok: true; survey: Survey } | { ok: false; error: string } {
  if (!res) return { ok: false, error: 'No survey' }
  if (typeof res !== 'object') return { ok: false, error: 'Survey is not object' }
  if (!('questions' in res)) return { ok: false, error: 'No questions in survey' }
  if (!Array.isArray(res.questions)) return { ok: false, error: 'Questions are not an array' }
  if (!res.questions.every(isSurveyQuestion))
    return { ok: false, error: 'Questions have wrong format' }
  if (!('surveyId' in res) || typeof res.surveyId !== 'string')
    return { ok: false, error: 'Wrong surveyId type' }

  return { ok: true, survey: { questions: res.questions, surveyId: res.surveyId } }
}
export class SurveyController extends EventEmitter implements ISurveyController {
  #callRelayer: BindedRelayerCall

  survey: SurveyFetchingStatus = { status: 'empty' }
  constructor({
    fetch,
    relayerUrl,
    eventEmitterRegistry
  }: {
    fetch: Fetch
    relayerUrl: string
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  }

  async fetchSurvey(surveyId: Survey['surveyId']) {
    console.log('fetch survey')
    this.survey = { status: 'loading', surveyId }
    this.emitUpdate()

    let res: any
    console.log(`/promotions/survey/${surveyId}`)
    try {
      res = await this.#callRelayer(
        `/promotions/survey/${surveyId}`,
        'GET',
        undefined,
        undefined,
        5000
      )
    } catch (e: any) {
      console.error(`relayer error for getting survey ${surveyId}`)
      this.survey = { status: 'error', error: e as Error, surveyId }
      this.emitUpdate()
      return
    }

    const parsedSurvey = parseSurvey(res.survey as unknown)
    if (!parsedSurvey.ok) {
      console.log(`Error with parsing a survey ${parsedSurvey.error}`)
      this.emitError({
        message: 'There was error fetching the survey.',
        level: 'major',

        sendCrashReport: true,
        error: Error(`Error with parsing a survey ${parsedSurvey.error}`)
      })
      this.survey = {
        status: 'error',
        error: Error(`Error with parsing a survey ${parsedSurvey.error}`),
        surveyId
      }
      this.emitUpdate()
      return
    }
    this.survey = { status: 'success', survey: parsedSurvey.survey, surveyId }
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
