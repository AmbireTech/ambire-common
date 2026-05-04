import { Survey } from '@/interfaces/survey'

export function isValidResponseOption(
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

export function isSurveyQuestion(q: unknown): Survey['questions'][number] | null {
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
export function parseSurvey(
  res: unknown
): { ok: true; survey: Survey } | { ok: false; error: string } {
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
