"use client";

import { Download, FileJson, FileSpreadsheet, FileText, Megaphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { FilterSelect } from "@/components/filters/filter-select";
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

interface ExportClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
}

export function ExportClient({ campaigns, forms }: ExportClientProps) {
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
        throw new Error(payload?.error?.message ?? "No fue posible generar la exportación.");
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error("No hay datos para exportar.");
      const disposition = response.headers.get("content-disposition");
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ?? `evaluaciones_${Date.now()}.${format}`;
      downloadFile(blob, filename);
      toast.success(`${format === "xlsx" ? "Excel" : format.toUpperCase()} exportado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al exportar");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Exportar Datos</h1>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FilterSelect
              id="export-campaign"
              label="Campaña"
              value={campaignId || "all"}
              options={[
                { value: "all", label: "Todas" },
                ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
              ]}
              onValueChange={(value) => {
                setCampaignId(value === "all" ? "" : value);
                setFormId("");
              }}
              placeholder="Todas"
              icon={Megaphone}
            />
            <FilterSelect
              id="export-form"
              label="Formulario"
              value={formId || "all"}
              options={[
                { value: "all", label: "Todos" },
                ...filteredForms.map((form) => ({ value: form.id, label: form.title })),
              ]}
              onValueChange={(value) => setFormId(value === "all" ? "" : value)}
              placeholder="Todos"
              icon={FileText}
            />
            <DateRangeFilter
              id="export-period"
              label="Periodo"
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
            <CardTitle className="text-base">Campos exportables</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedFields(DEFAULT_EXPORT_FIELDS)}
              >
                Default
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedFields(ALL_EXPORT_FIELDS)}
              >
                Todos
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-3">
            {EXPORT_FIELD_GROUPS.map((group) => (
              <div key={group.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-b pb-2">
                  <p className="text-sm font-medium">{group.label}</p>
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
                          {field.label}
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
              <p className="font-medium">Exportar CSV</p>
              <p className="text-sm text-muted-foreground">Compatible con Excel y Google Sheets</p>
            </div>
            <Button
              onClick={() => handleExport("csv")}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "csv" ? "Exportando..." : "Descargar CSV"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <FileJson className="h-12 w-12 text-blue-600" />
            <div className="text-center">
              <p className="font-medium">Exportar JSON</p>
              <p className="text-sm text-muted-foreground">Datos estructurados para integración</p>
            </div>
            <Button
              onClick={() => handleExport("json")}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "json" ? "Exportando..." : "Descargar JSON"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <FileSpreadsheet className="h-12 w-12 text-emerald-600" />
            <div className="text-center">
              <p className="font-medium">Exportar Excel</p>
              <p className="text-sm text-muted-foreground">Con formato, colores y filtros</p>
            </div>
            <Button
              onClick={() => handleExport("xlsx")}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "xlsx" ? "Exportando..." : "Descargar Excel"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
