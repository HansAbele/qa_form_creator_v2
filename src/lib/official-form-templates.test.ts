import { describe, expect, it } from "vitest";
import { formMutationSchema } from "@/types/form-builder";
import {
  HAPUSA_SCORECARD,
  HAPUSA_SCORECARD_KEY,
  PARKER_DAVIS_SCORECARD,
  PARKER_DAVIS_SCORECARD_KEY,
  isOfficialScorecardKey,
  parseOfficialQuestionLabel,
  resolveScorecardBand,
} from "./official-form-templates";
import { computeScore, type ScoringQuestion } from "./scoring";

describe("Parker Davis official QA scorecard", () => {
  it("matches the official 100-point structure and critical rules", () => {
    const scoredQuestions = PARKER_DAVIS_SCORECARD.questions.filter(
      (question) => question.weight > 0,
    );
    const fatalQuestions = PARKER_DAVIS_SCORECARD.questions.filter((question) => question.fatal);

    expect(scoredQuestions).toHaveLength(13);
    expect(scoredQuestions.reduce((total, question) => total + question.weight, 0)).toBe(100);
    expect(PARKER_DAVIS_SCORECARD.questions).toHaveLength(37);
    expect(fatalQuestions).toHaveLength(9);
    expect(fatalQuestions.every((question) => question.fatalOptions?.includes("No"))).toBe(true);
  });

  it("preserves half-point choices, including decimal values", () => {
    const fivePointQuestion = PARKER_DAVIS_SCORECARD.questions.find(
      (question) => question.weight === 5,
    );
    const fifteenPointQuestion = PARKER_DAVIS_SCORECARD.questions.find(
      (question) => question.weight === 15,
    );

    expect(fivePointQuestion?.optionPoints).toEqual([0, 2.5, 5]);
    expect(fifteenPointQuestion?.optionPoints).toEqual([0, 7.5, 15]);
    expect(
      formMutationSchema.safeParse({
        title: PARKER_DAVIS_SCORECARD.title,
        campaignId: "parker-davis",
        questions: PARKER_DAVIS_SCORECARD.questions,
      }).success,
    ).toBe(true);
  });

  it("resolves every official grading band and lets CF override the score", () => {
    expect(resolveScorecardBand(PARKER_DAVIS_SCORECARD.gradingScale, 97, false)?.label).toBe(
      "Pass (Excellent)",
    );
    expect(resolveScorecardBand(PARKER_DAVIS_SCORECARD.gradingScale, 92, false)?.label).toBe(
      "Acceptable",
    );
    expect(resolveScorecardBand(PARKER_DAVIS_SCORECARD.gradingScale, 85, false)?.label).toBe(
      "Fail (Needs Improvement)",
    );
    expect(resolveScorecardBand(PARKER_DAVIS_SCORECARD.gradingScale, 75, false)?.label).toBe(
      "Fail (Below Standard)",
    );
    expect(resolveScorecardBand(PARKER_DAVIS_SCORECARD.gradingScale, 69.99, false)?.label).toBe(
      "Fail (Unsatisfactory)",
    );
    expect(resolveScorecardBand(PARKER_DAVIS_SCORECARD.gradingScale, 100, true)?.label).toBe(
      "Fail — Critical Failure",
    );
  });

  it("keeps display metadata separate from the official question wording", () => {
    expect(parseOfficialQuestionLabel("[[CHECK]][[P&W]]• Obtains model number.")).toEqual({
      label: "• Obtains model number.",
      checkpoint: true,
      partsWarranty: true,
    });
  });

  it("keeps a perfect numeric score but forces FAIL when one CF check is No", () => {
    const questions: ScoringQuestion[] = PARKER_DAVIS_SCORECARD.questions.map(
      (question, index) => ({
        id: `question-${index}`,
        type: question.type,
        weight: question.weight,
        fatal: question.fatal,
        fatalOptions: question.fatalOptions ? [...question.fatalOptions] : [],
        requiresCommentOnFail: question.requiresCommentOnFail,
        categoryId: question.qaCategoryId,
        ratingFailThreshold: null,
        ratingMax: null,
        weightedOptions: question.options.map((value, optionIndex) => ({
          value,
          points: question.optionPoints[optionIndex] ?? 0,
        })),
      }),
    );
    const firstFatalIndex = PARKER_DAVIS_SCORECARD.questions.findIndex(
      (question) => question.fatal,
    );
    const answers = new Map(
      PARKER_DAVIS_SCORECARD.questions.map((question, index) => [
        `question-${index}`,
        {
          value: index === firstFatalIndex ? "No" : question.options[question.options.length - 1],
          notApplicable: false,
          comment: index === firstFatalIndex ? "Critical procedure was missed." : "",
        },
      ]),
    );

    const result = computeScore(questions, answers, { passThreshold: 95 });

    expect(result.score).toBe(100);
    expect(result.hasFatalFail).toBe(true);
    expect(result.result).toBe("FAIL");
  });
});

describe("HAPUSA official QA scorecard", () => {
  it("preserves the official 27-question, 100-point structure", () => {
    expect(HAPUSA_SCORECARD.questions).toHaveLength(27);
    expect(HAPUSA_SCORECARD.questions.reduce((total, question) => total + question.weight, 0)).toBe(
      100,
    );
    expect(
      HAPUSA_SCORECARD.questions.filter(
        (question) => question.qaCategoryName === "Account Verification",
      ),
    ).toHaveLength(5);
    expect(
      HAPUSA_SCORECARD.questions.filter(
        (question) =>
          question.qaCategoryName === "Problem Solving an account and Working the Account",
      ),
    ).toHaveLength(8);
  });

  it("keeps every allowed integer partial score and the 95% threshold", () => {
    const tenPointQuestion = HAPUSA_SCORECARD.questions.find((question) => question.weight === 10);

    expect(tenPointQuestion?.optionPoints).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(resolveScorecardBand(HAPUSA_SCORECARD.gradingScale, 95, false)?.result).toBe("PASS");
    expect(resolveScorecardBand(HAPUSA_SCORECARD.gradingScale, 94.99, false)?.result).toBe("FAIL");
  });

  it("recognizes both governed scorecard families", () => {
    expect(isOfficialScorecardKey(PARKER_DAVIS_SCORECARD_KEY)).toBe(true);
    expect(isOfficialScorecardKey(HAPUSA_SCORECARD_KEY)).toBe(true);
    expect(isOfficialScorecardKey("CUSTOM")).toBe(false);
  });
});
