"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextQuestionForAnswers = getNextQuestionForAnswers;
function getNextQuestionForAnswers(questions, answers) {
    const positionOfLastAnsweredQuestion = Math.max(...Object.values(answers).map((a) => Number(a.questionPosition)));
    const question = questions.find((q) => q.questionPosition === positionOfLastAnsweredQuestion + 1 &&
        (!q.requirement || answers[q.requirement.questionId]?.answer === q.requirement.responseId));
    return question;
}
//# sourceMappingURL=survey.js.map