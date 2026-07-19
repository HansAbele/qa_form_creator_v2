import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, translate } from "./i18n";

describe("i18n", () => {
  it("uses English as the product default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(translate(DEFAULT_LOCALE, "Settings")).toBe("Settings");
  });

  it("keeps Spanish available", () => {
    expect(translate("es", "Settings")).toBe("Configuración");
    expect(translate("es", "Dispositions")).toBe("Disposiciones");
    expect(translate("es", "Unable to load data")).toBe("No pudimos cargar los datos");
    expect(translate("es", "All time")).toBe("Todo el periodo");
    expect(translate("es", "Evaluation Drafts")).toBe("Borradores de evaluación");
    expect(translate("es", "Evaluated Calls")).toBe("Llamadas evaluadas");
  });

  it("interpolates values without dropping unknown placeholders", () => {
    expect(translate("en", "Welcome, {name}", { name: "Elena" })).toBe("Welcome, Elena");
    expect(translate("es", "Welcome, {name}")).toBe("Welcome, {name}");
  });

  it("only accepts supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });
});
