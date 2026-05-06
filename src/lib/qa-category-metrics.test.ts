import { describe, expect, it } from "vitest";
import { buildQACategoryMetrics } from "./qa-category-metrics";

describe("buildQACategoryMetrics", () => {
  it("groups scored answers by QA category and orders highest risk first", () => {
    const metrics = buildQACategoryMetrics([
      {
        responseId: "response-1",
        categoryId: "cat-resolution",
        categoryName: "Resolucion",
        categoryColor: "#ff6600",
        categoryIcon: "target",
        score: 100,
        passThreshold: 70,
        isFatalFail: false,
        comment: null,
      },
      {
        responseId: "response-2",
        categoryId: "cat-resolution",
        categoryName: "Resolucion",
        categoryColor: "#ff6600",
        categoryIcon: "target",
        score: 60,
        passThreshold: 70,
        isFatalFail: false,
        comment: "Debe mejorar",
      },
      {
        responseId: "response-3",
        categoryId: "cat-compliance",
        categoryName: "Cumplimiento",
        categoryColor: "#dc2626",
        categoryIcon: "shield",
        score: 40,
        passThreshold: 70,
        isFatalFail: true,
        comment: "Falla fatal",
      },
    ]);

    expect(metrics).toEqual([
      {
        id: "cat-compliance",
        name: "Cumplimiento",
        color: "#dc2626",
        icon: "shield",
        totalAnswers: 1,
        totalEvaluations: 1,
        avgScore: 40,
        failedAnswers: 1,
        failRate: 100,
        fatalFailCount: 1,
        commentCount: 1,
      },
      {
        id: "cat-resolution",
        name: "Resolucion",
        color: "#ff6600",
        icon: "target",
        totalAnswers: 2,
        totalEvaluations: 2,
        avgScore: 80,
        failedAnswers: 1,
        failRate: 50,
        fatalFailCount: 0,
        commentCount: 1,
      },
    ]);
  });

  it("ignores unscored answers", () => {
    expect(
      buildQACategoryMetrics([
        {
          responseId: "response-1",
          categoryId: "cat-text",
          categoryName: "Notas",
          categoryColor: null,
          categoryIcon: null,
          score: null,
          passThreshold: 70,
          isFatalFail: false,
          comment: "Texto libre",
        },
      ]),
    ).toEqual([]);
  });
});
