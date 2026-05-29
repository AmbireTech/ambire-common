"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurveyController = exports.ANSWERED_SURVEYS_STORAGE_KEY = void 0;
const tslib_1 = require("tslib");
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
const survey_1 = require("../../utils/survey");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const helpers_1 = require("./helpers");
exports.ANSWERED_SURVEYS_STORAGE_KEY = 'surveysRespondedTo';
class SurveyController extends eventEmitter_1.default {
    #callRelayer;
    #surveysRespondedTo;
    #storage;
    initialLoadPromise;
    #survey;
    #dismissBanner;
    bannerId;
    surveyId;
    answers = {};
    status = 'not-started';
    errorMessage;
    constructor({ fetch, relayerUrl, storage, eventEmitterRegistry, ui, dismissBanner }) {
        super(eventEmitterRegistry);
        this.#callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
        this.#storage = storage;
        this.initialLoadPromise = this.#load().finally(() => (this.initialLoadPromise = undefined));
        this.#dismissBanner = dismissBanner;
        ui.uiEvent.on('removeView', () => {
            if (this.status === 'success-submitted') {
                this.clearSurveyState();
            }
        });
    }
    async #load() {
        const surveysRespondedTo = await this.#storage.get(exports.ANSWERED_SURVEYS_STORAGE_KEY, []);
        this.#surveysRespondedTo = surveysRespondedTo;
        this.emitUpdate();
    }
    get isReady() {
        return !!this.#surveysRespondedTo;
    }
    isSurveyAnswered(surveyId) {
        // just to make sure we do not say a survey is unanswered when have
        // not yet loaded surveys from the storage
        if (!this.#surveysRespondedTo)
            return true;
        return this.#surveysRespondedTo.includes(surveyId);
    }
    async fetchSurvey(surveyId, bannerId) {
        if (this.status !== 'not-started' && this.status !== 'error-fetching')
            return;
        this.status = 'loading-fetching';
        this.surveyId = surveyId;
        this.emitUpdate();
        let res;
        try {
            res = await this.#callRelayer(`/promotions/survey/${surveyId}`, 'GET', undefined, undefined, 5000);
        }
        catch (e) {
            this.status = 'error-fetching';
            this.emitError({
                error: e,
                level: 'silent',
                message: 'Failed to fetch survey'
            });
            this.errorMessage = e.message;
            this.emitUpdate();
            return;
        }
        const parsedSurvey = (0, helpers_1.parseSurvey)(res.survey);
        if (!parsedSurvey.ok) {
            this.emitError({
                message: 'There was error fetching the survey.',
                level: 'silent',
                error: Error(`Error with parsing a survey ${parsedSurvey.error}`)
            });
            this.status = 'error-fetching';
            this.errorMessage = parsedSurvey.error;
            this.emitUpdate();
            return;
        }
        this.bannerId = bannerId;
        this.#survey = parsedSurvey.survey;
        this.status = 'success-fetched';
        this.emitUpdate();
    }
    async #storeSurveyIdAsRespondedTo(surveyId) {
        await this.initialLoadPromise;
        if (!this.#surveysRespondedTo) {
            this.emitError({
                message: 'Failed to record that survey is answered locally',
                level: 'major',
                error: new Error('Failed to record the surveyId locally as responded to: this.#surveysRespondedTo was missing')
            });
            return;
        }
        this.#surveysRespondedTo.push(surveyId);
        await this.#storage.set('surveysRespondedTo', this.#surveysRespondedTo);
    }
    async sendResponse(instanceId, address) {
        if (!this.#survey) {
            this.emitError({
                error: new Error('Error: this.#survey does not exist when attempting to submit answers'),
                level: 'major',
                message: 'Failed to submit your answer, please contact support'
            });
            this.status = 'error-submitting';
            this.errorMessage = 'Internal state error: missing survey';
            this.emitUpdate();
            return;
        }
        if (!this.answers || !Object.keys(this.answers).length) {
            this.emitError({
                error: new Error('Error: this.answers does not exist when attempting to submit answers'),
                level: 'major',
                message: 'Failed to submit your answer, please contact support'
            });
            this.status = 'error-submitting';
            this.errorMessage = 'Internal state error: missing answers';
            this.emitUpdate();
            return;
        }
        if (this.status !== 'success-fetched' && this.status !== 'error-submitting')
            return;
        try {
            const payload = {
                surveyId: this.#survey.surveyId,
                address: address,
                instanceId: instanceId,
                responses: Object.entries(this.answers).map(([questionId, { answer }]) => ({
                    questionId: Number(questionId),
                    answer
                }))
            };
            this.status = 'loading-sending';
            this.emitUpdate();
            await this.#callRelayer(`/promotions/survey`, 'POST', payload, undefined, 5000);
            this.status = 'success-submitted';
            this.emitUpdate();
            await this.#storeSurveyIdAsRespondedTo(this.#survey.surveyId);
            if (this.bannerId)
                this.#dismissBanner(this.bannerId);
            this.bannerId = undefined;
            this.surveyId = undefined;
        }
        catch (e) {
            this.emitError({
                message: 'Failed to submit response.',
                level: 'silent',
                error: e
            });
            this.status = 'error-submitting';
            this.errorMessage = e.message;
            this.emitUpdate();
        }
    }
    async answerQuestion(questionId, questionPosition, answer, instanceId, address) {
        this.answers[questionId] = { questionPosition, answer };
        const hasNextQuestion = !!(0, survey_1.getNextQuestionForAnswers)(this.questions || [], this.answers);
        if (!hasNextQuestion)
            await this.sendResponse(instanceId, address);
        this.emitUpdate();
    }
    get currentQuestion() {
        if (this.status !== 'success-fetched')
            return;
        if (!this.#survey)
            return;
        if (Object.keys(this.answers).length === 0)
            return this.#survey.questions.find((q) => q.questionPosition === 0);
        return (0, survey_1.getNextQuestionForAnswers)(this.#survey.questions, this.answers);
    }
    clearSurveyState() {
        this.status = 'not-started';
        this.answers = {};
        this.#survey = undefined;
        this.surveyId = undefined;
        this.errorMessage = undefined;
        this.bannerId = undefined;
        this.emitUpdate();
    }
    get hasPersistentState() {
        return this.status !== 'not-started';
    }
    get questions() {
        return this.#survey?.questions;
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            isReady: this.isReady,
            currentQuestion: this.currentQuestion,
            hasPersistentState: this.hasPersistentState,
            questions: this.questions
        };
    }
}
exports.SurveyController = SurveyController;
//# sourceMappingURL=survey.js.map