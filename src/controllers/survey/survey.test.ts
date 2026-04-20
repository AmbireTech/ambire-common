import { Survey } from '@/interfaces/survey'
import { expect } from '@jest/globals'
import { produceMemoryStore } from '@test/helpers'
import { mockUiManager } from '@test/helpers/ui'

import { EventEmitterRegistryController } from '../eventEmitterRegistry/eventEmitterRegistry'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { ANSWERED_SURVEYS_STORAGE_KEY, SurveyController } from './survey'

const mockFetch = jest.fn()
const surveys: Record<string, Survey> = {
  'happy-case': {
    questions: [
      {
        id: 0,
        questionPosition: 0,
        text: 'Question 1',
        responseOptions: [
          { text: 'Answer 1', id: 0 },
          { text: 'Answer 2', id: 1 }
        ],
        responseType: 'singleChoice'
      },
      {
        id: 1,
        questionPosition: 1,
        text: 'Question 2',
        responseOptions: null,
        responseType: 'openText'
      }
    ],
    surveyId: 'happy-case'
  },
  'two-flow-survey': {
    questions: [
      {
        id: 0,
        questionPosition: 0,
        text: 'What should be the next question',
        responseOptions: [
          { text: 'Closed', id: 0 },
          { text: 'Open', id: 1 }
        ],
        responseType: 'singleChoice'
      },
      {
        id: 1,
        questionPosition: 1,
        text: 'Closed answer question',
        requirement: { questionId: 0, responseId: 0 },
        responseOptions: [
          { text: 'Answer 1', id: 0 },
          { text: 'Answer 2', id: 1 }
        ],
        responseType: 'singleChoice'
      },
      {
        id: 1,
        requirement: { questionId: 0, responseId: 1 },
        questionPosition: 1,
        text: 'Open question',
        responseOptions: null,
        responseType: 'openText'
      }
    ],
    surveyId: '2-flow-question'
  }
}

let sentData
mockFetch.mockImplementation(async (url: string, ...args) => {
  if (url.startsWith('https://relayer.ambire.com/promotions/survey/') && args[0].method === 'GET') {
    const surveyIdToReturn = url.split('/survey/')[1]!

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ survey: surveys[surveyIdToReturn] })
    }
  }
  if (url.startsWith('https://relayer.ambire.com/promotions/survey') && args[0].method === 'POST') {
    sentData = JSON.parse(args[0].body)
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true })
    }
  }
  return { ok: false, status: 404 }
})

const getFreshControllers = () => {
  const { uiManager } = mockUiManager()

  const eventEmitterRegistry = new EventEmitterRegistryController(() => null)

  const storage = new StorageController(produceMemoryStore())

  return {
    storage,
    getFreshSurveyController: () => {
      return new SurveyController({
        fetch: mockFetch,
        relayerUrl: 'https://relayer.ambire.com',
        storage,
        eventEmitterRegistry,
        ui: new UiController({ eventEmitterRegistry, uiManager })
      })
    }
  }
}

describe('SurveyController', () => {
  test('Should load properly', async () => {
    const { storage, getFreshSurveyController } = getFreshControllers()
    await storage.set(ANSWERED_SURVEYS_STORAGE_KEY, ['test-survey'])
    const surveyController = getFreshSurveyController()
    expect(surveyController.isReady).toBeFalsy()
    await surveyController.initialLoadPromise
    expect(surveyController.isSurveyAnswered('test-survey')).toBeTruthy()
    expect(surveyController.status).toBe('not-started')
  })
  test('Happy case: fetch, answer, submit survey', async () => {
    const { getFreshSurveyController } = getFreshControllers()
    const surveyController = getFreshSurveyController()

    let hadLoadingFetch
    let hadSuccessFetch
    let waitFetch = new Promise((res) =>
      surveyController.onUpdate(() => {
        if (surveyController.status === 'loading-fetching') hadLoadingFetch = true
        if (surveyController.status === 'success-fetched') {
          hadSuccessFetch = true
          res(null)
        }
      })
    )
    surveyController.fetchSurvey('happy-case')
    await waitFetch
    expect(hadLoadingFetch).toBeTruthy()
    expect(hadSuccessFetch).toBeTruthy()
    expect(surveyController.status).toBe('success-fetched')
    expect(surveyController.currentQuestion).toMatchObject(surveys['happy-case']?.questions[0]!)
    void surveyController.answerQuestion(
      surveyController.currentQuestion?.id!,
      surveyController.currentQuestion?.questionPosition!,
      surveyController.currentQuestion?.responseOptions![0]?.id!,
      'instanceId',
      'address'
    )
    expect(
      SurveyController.getNextQuestionForAnswers(
        surveyController.questions!,
        surveyController.answers
      )
    ).toMatchObject(surveys['happy-case']?.questions[1]!)

    let hadLoadingSend
    let hadSuccessSend
    let waitToSend = new Promise((res) =>
      surveyController.onUpdate(() => {
        if (surveyController.status === 'loading-sending') hadLoadingSend = true
        if (surveyController.status === 'success-submitted') {
          hadSuccessSend = true
          res(null)
        }
      })
    )
    void surveyController.answerQuestion(
      surveyController.currentQuestion?.id!,
      surveyController.currentQuestion?.questionPosition!,
      'Answer',
      'instanceId',
      'address'
    )
    await waitToSend
    expect(hadLoadingSend).toBeTruthy()
    expect(hadSuccessSend).toBeTruthy()
    expect(surveyController.status).toBe('success-submitted')
    expect(sentData!).toMatchObject({
      surveyId: 'happy-case',
      address: 'address',
      instanceId: 'instanceId',
      responses: [
        { questionId: 0, answer: 0 },
        { questionId: 1, answer: 'Answer' }
      ]
    })
  })

  test('Survey id should be in storage after survey is answered ', async () => {
    const { storage, getFreshSurveyController } = getFreshControllers()
    const surveyController = getFreshSurveyController()

    let waitFetch = new Promise((res) =>
      surveyController.onUpdate(() => surveyController.status === 'success-fetched' && res(null))
    )

    surveyController.fetchSurvey('happy-case')
    await waitFetch

    void surveyController.answerQuestion(
      surveyController.currentQuestion?.id!,
      surveyController.currentQuestion?.questionPosition!,
      surveyController.currentQuestion?.responseOptions![0]?.id!,
      'instanceId',
      'address'
    )
    let waitToSend = new Promise((res) =>
      surveyController.onUpdate(() => surveyController.status === 'success-submitted' && res(null))
    )
    await surveyController.answerQuestion(
      surveyController.currentQuestion?.id!,
      surveyController.currentQuestion?.questionPosition!,
      'Answer',
      'instanceId',
      'address'
    )
    await waitToSend
    expect(
      (await storage.get(ANSWERED_SURVEYS_STORAGE_KEY, [])).includes('happy-case')
    ).toBeTruthy()
    expect(surveyController.isSurveyAnswered('happy-case')).toBeTruthy()
  })

  test('We should be able to access both both flows of a 2 flow survey', async () => {
    // we will keep them separated in two scopes
    // flow 1
    await (async () => {
      const { getFreshSurveyController } = getFreshControllers()
      const surveyController = getFreshSurveyController()
      let waitFetch = new Promise((res) =>
        surveyController.onUpdate(() => surveyController.status === 'success-fetched' && res(null))
      )

      surveyController.fetchSurvey('two-flow-survey')
      await waitFetch
      // should lead to the closed answer question
      let waitAnswer = new Promise((r) => surveyController.onUpdate(r))
      void surveyController.answerQuestion(0, 0, 0, 'instanceId', 'address')
      await waitAnswer

      expect(surveyController.currentQuestion).toMatchObject(
        surveys['two-flow-survey']?.questions[1]!
      )
    })()
    await (async () => {
      const { getFreshSurveyController } = getFreshControllers()
      const surveyController = getFreshSurveyController()
      let waitFetch = new Promise((res) =>
        surveyController.onUpdate(() => surveyController.status === 'success-fetched' && res(null))
      )
      surveyController.fetchSurvey('two-flow-survey')
      await waitFetch

      let waitAnswer = new Promise((r) => surveyController.onUpdate(r))
      // should lead to the open answer question
      void surveyController.answerQuestion(0, 0, 1, 'instanceId', 'address')
      await waitAnswer
      expect(surveyController.currentQuestion).toMatchObject(
        surveys['two-flow-survey']?.questions[2]!
      )
    })()
  })
})
