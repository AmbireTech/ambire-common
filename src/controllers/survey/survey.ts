import { IStorageController } from '@/interfaces/storage'
import { BindedRelayerCall, relayerCall } from '@/libs/relayerCall/relayerCall'

import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { ISurveyController, Survey, SurveyAnswers } from '../../interfaces/survey'
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

  #surveysRespondedTo?: string[]

  #storage: IStorageController

  #initialLoadPromise?: Promise<void>

  #survey?: Survey

  answers: SurveyAnswers = {}

  sourceBannerId?: string | number

  status:
    | 'not-started'
    | 'loading-fetching'
    | 'loading-sending'
    | 'error-fetching'
    | 'error-submitting'
    | 'success-fetched'
    | 'success-submitted' = 'not-started'

  constructor({
    fetch,
    relayerUrl,
    storage,
    eventEmitterRegistry
  }: {
    fetch: Fetch
    relayerUrl: string
    storage: IStorageController
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#storage = storage
    this.#initialLoadPromise = this.#load().finally(() => (this.#initialLoadPromise = undefined))
  }

  async #load() {
    const surveysRespondedTo: string[] = await this.#storage.get('surveysRespondedTo', [])
    this.#surveysRespondedTo = surveysRespondedTo
  }

  get isReady() {
    return !!this.#surveysRespondedTo
  }

  isSurveyAnswered(surveyId: Survey['surveyId']): boolean {
    // just to make sure we do not say a survey is unanswered when have
    // not yet loaded surveys from the storage
    if (!this.#surveysRespondedTo) return true
    return this.#surveysRespondedTo.includes(surveyId)
  }

  // TODO: should we refactor the controller?
  async fetchSurvey(surveyId: Survey['surveyId'], sourceBannerId?: string | number) {
    this.status = 'loading-fetching'
    this.emitUpdate()

    let res: any

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
      this.status = 'error-fetching'
      this.emitError({
        error: e,
        level: 'major',
        message: 'Failed to fetch survey',
        sendCrashReport: true
      })
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
      this.status = 'error-fetching'
      this.emitUpdate()
      return
    }
    if (sourceBannerId) this.sourceBannerId = sourceBannerId
    this.#survey = parsedSurvey.survey
    this.status = 'success-fetched'
    this.emitUpdate()
  }

  async #storeSurveyIdAsRespondedTo(surveyId: string) {
    await this.#initialLoadPromise

    if (!this.#surveysRespondedTo) {
      this.emitError({
        message: 'Failed to record that survey is answered locally',
        level: 'major',
        sendCrashReport: true,
        error: new Error(
          'Failed to record the surveyId locally as responded to: this.#surveysRespondedTo was missing'
        )
      })
      return
    }

    this.#surveysRespondedTo.push(surveyId)
    await this.#storage.set('surveysRespondedTo', this.#surveysRespondedTo)
  }

  async #sendResponse(instanceId: string, address: string) {
    if (this.#survey) {
      if (!this.answers || !Object.keys(this.answers).length) {
        this.emitError({
          error: new Error('Error: this.answers does not exist when attempting to submit answers'),
          level: 'major',
          message: 'Failed to submit your answer, please contact support',
          sendCrashReport: true
        })
        this.status = 'error-submitting'
        this.emitUpdate()
      }

      try {
        const payload = {
          surveyId: this.#survey.surveyId,
          address: address,
          instanceId: instanceId,
          responses: Object.entries(this.answers).map(([questionId, { answer }]) => ({
            questionId: Number(questionId),
            answer
          }))
        }
        this.status = 'loading-sending'
        this.emitUpdate()

        await this.#callRelayer(`/promotions/survey`, 'POST', payload, undefined, 5000)
        this.status = 'success-submitted'
        this.emitUpdate()
        await this.#storeSurveyIdAsRespondedTo(this.#survey.surveyId)
        this.sourceBannerId = undefined
      } catch (e: any) {
        this.emitError({
          message: 'Failed to submit response.',
          level: 'major',
          error: e
        })
        this.status = 'error-submitting'
        this.emitUpdate()
      }
    } else {
      this.emitError({
        error: new Error('Error: this.#survey does not exist when attempting to submit answers'),
        level: 'major',
        message: 'Failed to submit your answer, please contact support',
        sendCrashReport: true
      })
      this.status = 'error-submitting'
      this.emitUpdate()
    }
  }

  async answerQuestion(
    questionId: number,
    questionPosition: number,
    answer: number | string,
    instanceId: string,
    address: string
  ) {
    this.answers[questionId] = { questionPosition, answer }

    const answersPlusUncommited: SurveyAnswers = {
      ...this.answers,

      [questionId]: {
        questionPosition: questionPosition,
        answer: answer
      }
    }
    const hasNextQuestion = !!SurveyController.getNextQuestionForAnswers(
      this.questions || [],
      answersPlusUncommited
    )

    if (!hasNextQuestion) await this.#sendResponse(instanceId, address)
    this.emitUpdate()
  }

  get currentQuestion(): Survey['questions'][number] | undefined {
    if (this.status !== 'success-fetched') return
    if (!this.#survey) return
    if (Object.keys(this.answers).length === 0)
      return this.#survey.questions.find((q) => q.questionPosition === 0)
    return SurveyController.getNextQuestionForAnswers(this.#survey.questions, this.answers)
  }

  clearSurveyState() {
    this.status = 'not-started'
    this.answers = {}
    this.#survey = undefined
  }

  get hasPersistentState() {
    return this.status !== 'not-started'
  }

  static getNextQuestionForAnswers(
    questions: Survey['questions'],
    answers: SurveyAnswers
  ): Survey['questions'][number] | undefined {
    const positionOfLastAnsweredQuestion = Math.max(
      ...Object.values(answers).map((a) => Number(a.questionPosition))
    )
    const question = questions.find(
      (q) =>
        q.questionPosition === positionOfLastAnsweredQuestion + 1 &&
        (!q.requirement || answers[q.requirement.questionId]?.answer === q.requirement.responseId)
    )

    return question
  }

  get questions(): Survey['questions'] | undefined {
    return this.#survey?.questions
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isReady: this.isReady,
      currentQuestion: this.currentQuestion,
      hasPersistentState: this.hasPersistentState,
      questions: this.questions
    }
  }
}
