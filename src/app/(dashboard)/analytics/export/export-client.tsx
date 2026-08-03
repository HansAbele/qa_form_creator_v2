"use client";

import { Download, FileJson, FileSpreadsheet, FileText, Megaphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { FilterSelect } from "@/components/filters/filter-select";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ALL_EXPORT_FIELDS,
  DEFAULT_EXPORT_FIELDS,
  EXPORT_FIELD_GROUPS,
  type ExportFieldKey,
} from "@/lib/export-fields";
import { formDisplayName } from "@/lib/form-display-name";

interface ExportClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
  initialCampaignId?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
}

export function ExportClient({
  campaigns,
  forms,
  initialCampaignId,
  initialDateFrom,
  initialDateTo,
}: ExportClientProps) {
  const { t } = useI18n();
  const [campaignId, setCampaignId] = useState(
    campaigns.length === 1 ? (campaigns[0]?.id ?? "") : (initialCampaignId ?? ""),
  );
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");
  const [selectedFields, setSelectedFields] = useState<ExportFieldKey[]>(DEFAULT_EXPORT_FIELDS);
  const [exporting, setExporting] = useState<string | null>(null);

  const filteredForms = campaignId ? forms.filter((f) => f.campaignId === campaignId) : forms;

  const getFilters = () => ({
    campaignId: campaignId || undefined,
    formId: formId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    fields: selectedFields,
  });

  const toggleField = (field: ExportFieldKey, checked: boolean) => {
    setSelectedFields((current) => {
      if (checked) return current.includes(field) ? current : [...current, field];
      if (current.length === 1) return current;
      return current.filter((item) => item !== field);
    });
  };

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: "csv" | "json" | "xlsx") => {
    setExporting(format);
    try {
      const response = await fetch(`/api/exports/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getFilters()),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? t("Unable to generate the export."));
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error(t("No data to export."));
      const disposition = response.headers.get("content-disposition");
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ?? `evaluations_${Date.now()}.${format}`;
      downloadFile(blob, filename);
      toast.success(
        t("{format} exported", { format: format === "xlsx" ? "Excel" : format.toUpperCase() }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Export failed"));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("Export Data")}</h1>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.length === 1 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("Campaign")}</p>
                <div className="flex min-h-10 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm">
                  <span className="font-medium">{campaigns[0]?.name}</span>
                  <Badge variant="secondary">{t("Automatic")}</Badge>
                </div>
              </div>
            ) : (
              <FilterSelect
                id="export-campaign"
                label={t("Campaign")}
                value={campaignId || "all"}
                options={[
                  { value: "all", label: t("All") },
                  ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
                ]}
                onValueChange={(value) => {
                  setCampaignId(value === "all" ? "" : value);
                  setFormId("");
                }}
                placeholder={t("All")}
                icon={Megaphone}
              />
            )}
            <FilterSelect
              id="export-form"
              label={t("Form")}
              value={formId || "all"}
              options={[
                { value: "all", label: t("All") },
                ...filteredForms.map((form) => ({
                  value: form.id,
                  label: formDisplayName(form.title),
                })),
              ]}
              onValueChange={(value) => setFormId(value === "all" ? "" : value)}
              placeholder={t("All")}
              icon={FileText}
            />
            <DateRangeFilter
              id="export-period"
              label={t("Period")}
              from={dateFrom}
              to={dateTo}
              onApply={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
              }}
              align="start"
              className="sm:col-span-2 lg:col-span-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Field Selection */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">{t("Exportable fields")}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedFields(DEFAULT_EXPORT_FIELDS)}
              >
                {t("Default")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedFields(ALL_EXPORT_FIELDS)}
              >
                {t("All")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-3">
            {EXPORT_FIELD_GROUPS.map((group) => (
              <div key={group.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-b pb-2">
                  <p className="text-sm font-medium">{t(group.label)}</p>
                  <span className="text-xs text-muted-foreground">
                    {group.fields.filter((field) => selectedFields.includes(field.key)).length}/
                    {group.fields.length}
                  </span>
                </div>
                <div className="grid gap-2">
                  {group.fields.map((field) => {
                    const id = `export-field-${field.key}`;
                    return (
                      <div key={field.key} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={selectedFields.includes(field.key)}
                          onCheckedChange={(checked) => toggleField(field.key, checked === true)}
                        />
                        <Label htmlFor={id} className="text-sm font-normal">
                          {t(field.label)}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Export Options */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <FileText className="h-12 w-12 text-green-600" />
            <div className="text-center">
              <p className="font-medium">{t("Export CSV")}</p>
              <p className="text-sm text-muted-foreground">
                {t("Compatible with Excel and Google Sheets")}
              </p>
            </div>
            <Button
              onClick={() => handleExport("csv")}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "csv" ? t("Exporting...") : t("Download CSV")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <FileJson className="h-12 w-12 text-blue-600" />
            <div className="text-center">
              <p className="font-medium">{t("Export JSON")}</p>
              <p className="text-sm text-muted-foreground">
                {t("Structured data for integrations")}
              </p>
            </div>
            <Button
              onClick={() => handleExport("json")}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "json" ? t("Exporting...") : t("Download JSON")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <FileSpreadsheet className="h-12 w-12 text-emerald-600" />
            <div className="text-center">
              <p className="font-medium">{t("Export Excel")}</p>
              <p className="text-sm text-muted-foreground">
                {t("Formatted with colors and filters")}
              </p>
            </div>
            <Button
              onClick={() => handleExport("xlsx")}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "xlsx" ? t("Exporting...") : t("Download Excel")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
