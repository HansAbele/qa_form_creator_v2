import { describe, expect, it } from "vitest";
import { QUESTION_TYPE_LABELS } from "@/types/form-builder";
import { FORMS_EVALUATIONS_ES_MESSAGES } from "./messages-forms-evaluations";

describe("forms and evaluations translations", () => {
  it("keeps the professional English labels as the source keys", () => {
    expect(QUESTION_TYPE_LABELS).toEqual({
      TEXT: "Text",
      RATING: "Rating",
      SELECT: "Dropdown",
      RADIO: "Single choice",
      BOOLEAN: "Yes / No",
    });
  });

  it("provides Spanish translations for the primary evaluation terminology", () => {
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Evaluated Calls"]).toBe("Llamadas evaluadas");
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Average Score"]).toBe("Puntuación promedio");
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Pass Rate"]).toBe("Tasa de aprobación");
    expect(FORMS_EVALUATIONS_ES_MESSAGES.Disposition).toBe("Disposición");
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Critical failures only"]).toBe("Solo fallas críticas");
  });

  it("preserves interpolation tokens", () => {
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Page {page} of {total}"]).toContain("{page}");
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Page {page} of {total}"]).toContain("{total}");
    expect(FORMS_EVALUATIONS_ES_MESSAGES["Weight {weight}%"]).toContain("{weight}");
  });
});
