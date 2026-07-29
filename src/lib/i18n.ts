import { ANALYTICS_ES_MESSAGES } from "@/lib/i18n/messages-analytics";
import { ADMIN_SETTINGS_ES_MESSAGES } from "@/lib/i18n/messages-admin-settings";
import { CALL_FINDER_ES_MESSAGES } from "@/lib/i18n/messages-call-finder";
import { FORMS_EVALUATIONS_ES_MESSAGES } from "@/lib/i18n/messages-forms-evaluations";

export const SUPPORTED_LOCALES = ["en", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type TranslationValues = Record<string, string | number>;

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "qore_locale";

const CORE_ES_MESSAGES = {
  "Adjust the filters or check back when new records are available.":
    "Ajusta los filtros o vuelve a consultar cuando existan nuevos registros.",
  "All time": "Todo el periodo",
  Apply: "Aplicar",
  Account: "Cuenta",
  "Account & security": "Cuenta y seguridad",
  Administration: "Administración",
  Agents: "Agentes",
  All: "Todas",
  Appearance: "Apariencia",
  "Appearance & language": "Apariencia e idioma",
  Campaign: "Campaña",
  Campaigns: "Campañas",
  "Check the link or ask your project administrator for access.":
    "Verifica el enlace o solicita acceso al administrador del proyecto.",
  "Collapse sidebar": "Contraer barra lateral",
  Dark: "Oscuro",
  "Date unavailable": "Fecha no disponible",
  Dashboard: "Dashboard",
  Dispositions: "Disposiciones",
  English: "Inglés",
  Evaluations: "Evaluaciones",
  "Expand sidebar": "Expandir barra lateral",
  Export: "Exportar",
  Forms: "Formularios",
  "From {date}": "Desde {date}",
  KPIs: "KPIs",
  Language: "Idioma",
  "Last 30 days": "Últimos 30 días",
  "Last 7 days": "Últimos 7 días",
  "Last 90 days": "Últimos 90 días",
  Light: "Claro",
  "My account": "Mi cuenta",
  "Main menu": "Menú principal",
  "Manage agents": "Gestionar agentes",
  "Manage dispositions": "Gestionar disposiciones",
  "Manage teams": "Gestionar equipos",
  "Next month": "Mes siguiente",
  "No data available": "No hay datos disponibles",
  "Open main menu": "Abrir menú principal",
  Operations: "Operación",
  "Page not found": "Página no encontrada",
  Period: "Periodo",
  "Previous month": "Mes anterior",
  Performance: "Rendimiento",
  Preferences: "Preferencias",
  "Primary navigation": "Navegación principal",
  Reports: "Reportes",
  "Reference: {reference}": "Referencia: {reference}",
  "Return home": "Volver al inicio",
  Retry: "Reintentar",
  "Select a range": "Selecciona un rango",
  Settings: "Configuración",
  "Sign out": "Cerrar sesión",
  "Signing out…": "Cerrando sesión…",
  Spanish: "Español",
  System: "Sistema",
  Teams: "Equipos",
  "The incident was logged. Try again in a few seconds.":
    "El incidente fue registrado. Intenta nuevamente en unos segundos.",
  "The incident was logged. Try again to recover the application.":
    "El incidente fue registrado. Intenta nuevamente para recuperar la aplicación.",
  "The incident was logged. You can try again without losing your session.":
    "El incidente fue registrado. Puedes intentarlo nuevamente sin perder tu sesión.",
  "The requested address does not exist, was moved, or is no longer available.":
    "La dirección solicitada no existe, fue movida o ya no está disponible.",
  "This content": "Este contenido",
  "This month": "Este mes",
  Today: "Hoy",
  "Today · {date}": "Hoy · {date}",
  "Unable to load data": "No pudimos cargar los datos",
  "Unable to load this section": "No pudimos cargar esta sección",
  "Unexpected Qore error": "Error inesperado de Qore",
  "Until {date}": "Hasta {date}",
  "Qore encountered an unexpected problem": "Qore encontró un problema inesperado",
  Users: "Usuarios",
  Workspace: "Espacio de trabajo",
  "{resource} is unavailable": "{resource} no está disponible",
  "Your account, appearance, and language.": "Tu cuenta, apariencia e idioma.",
} as const;

const spanishMessages: Record<string, string> = {
  ...ANALYTICS_ES_MESSAGES,
  ...FORMS_EVALUATIONS_ES_MESSAGES,
  ...ADMIN_SETTINGS_ES_MESSAGES,
  ...CALL_FINDER_ES_MESSAGES,
  ...CORE_ES_MESSAGES,
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "es";
}

export function translate(locale: Locale, message: string, values: TranslationValues = {}): string {
  const template = locale === "es" ? (spanishMessages[message] ?? message) : message;

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function getSpanishMessages(): Readonly<Record<string, string>> {
  return spanishMessages;
}
