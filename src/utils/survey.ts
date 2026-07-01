import { Survey, SurveyAnswers } from '@/interfaces/survey'

export function getNextQuestionForAnswers(
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
