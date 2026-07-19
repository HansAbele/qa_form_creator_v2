"use client";

import { Languages, Monitor, Moon, Settings2, Sun } from "lucide-react";
import { ProfileNavigation } from "@/components/account/profile-navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { useTheme } from "@/components/theme-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: "Light", description: "Use the light color palette.", icon: Sun },
  { value: "dark", label: "Dark", description: "Use the dark color palette.", icon: Moon },
  {
    value: "system",
    label: "System",
    description: "Match this device's appearance setting.",
    icon: Monitor,
  },
] as const;

const languageOptions = [
  { value: "en", label: "English", description: "Primary language" },
  { value: "es", label: "Español", description: "Alternative language" },
] as const;

export function PreferencesClient() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Settings2 aria-hidden="true" className="size-6 text-orange-500" />
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t("Preferences")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("Customize Qore's appearance and language.")}
        </p>
      </header>

      <ProfileNavigation />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Appearance")}</CardTitle>
            <CardDescription>{t("Choose how Qore looks on this device.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as (typeof themeOptions)[number]["value"])}
              aria-label={t("Appearance")}
            >
              {themeOptions.map((option) => {
                const selected = theme === option.value;
                const Icon = option.icon;

                return (
                  <label
                    key={option.value}
                    htmlFor={`theme-${option.value}`}
                    className={cn(
                      "flex min-h-18 w-full cursor-pointer items-center gap-3 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring motion-reduce:transition-none",
                      selected && "border-orange-500 bg-orange-50/70 dark:bg-orange-950/20",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t(option.label)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(option.description)}
                      </span>
                    </span>
                    <RadioGroupItem id={`theme-${option.value}`} value={option.value} />
                  </label>
                );
              })}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages aria-hidden="true" className="size-4 text-orange-500" />
              {t("Language")}
            </CardTitle>
            <CardDescription>
              {t("English is Qore's primary language. Spanish is also available.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={locale}
              onValueChange={(value) =>
                setLocale(value as (typeof languageOptions)[number]["value"])
              }
              aria-label={t("Language")}
            >
              {languageOptions.map((option) => {
                const selected = locale === option.value;

                return (
                  <label
                    key={option.value}
                    htmlFor={`language-${option.value}`}
                    className={cn(
                      "flex min-h-18 w-full cursor-pointer items-center gap-3 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring motion-reduce:transition-none",
                      selected && "border-orange-500 bg-orange-50/70 dark:bg-orange-950/20",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-foreground">
                      {option.value.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(option.description)}
                      </span>
                    </span>
                    <RadioGroupItem id={`language-${option.value}`} value={option.value} />
                  </label>
                );
              })}
            </RadioGroup>
            <p className="mt-4 text-xs text-muted-foreground">
              {t("Language changes are saved to your account and applied immediately.")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
