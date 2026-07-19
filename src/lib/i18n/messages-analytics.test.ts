import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n";
import { ANALYTICS_ES_MESSAGES } from "@/lib/i18n/messages-analytics";

describe("analytics messages", () => {
  it("keeps professional English keys with Spanish alternatives", () => {
    expect(ANALYTICS_ES_MESSAGES["Evaluated Calls"]).toBe("Llamadas evaluadas");
    expect(ANALYTICS_ES_MESSAGES["Average Score"]).toBe("Score promedio");
    expect(ANALYTICS_ES_MESSAGES["Critical Failures"]).toBe("Fallas críticas");
    expect(ANALYTICS_ES_MESSAGES.Dispositions).toBe("Disposiciones");
  });

  it("preserves interpolation variables", () => {
    expect(ANALYTICS_ES_MESSAGES["{name}: {count} evaluations"]).toContain("{name}");
    expect(ANALYTICS_ES_MESSAGES["{name}: {count} evaluations"]).toContain("{count}");
  });

  it("is integrated with the application translator", () => {
    expect(translate("es", "Evaluated Calls")).toBe("Llamadas evaluadas");
    expect(translate("es", "Critical Failures")).toBe("Fallas críticas");
  });
});
