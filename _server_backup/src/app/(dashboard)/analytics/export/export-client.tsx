"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileJson, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportToCsv, exportToJson, exportToExcel } from "@/server/actions/exports";

interface ExportClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
}

export function ExportClient({ campaigns, forms }: ExportClientProps) {
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const filteredForms = campaignId
    ? forms.filter((f) => f.campaignId === campaignId)
    : forms;

  useEffect(() => {
    setFormId("");
  }, [campaignId]);

  const getFilters = () => ({
    campaignId: campaignId || undefined,
    formId: formId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const bom = mimeType.includes("csv") ? "\uFEFF" : "";
    const blob = new Blob([bom + content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = async () => {
    setExporting("csv");
    try {
      const csv = await exportToCsv(getFilters());
      if (!csv) {
        toast.error("No hay datos para exportar");
        return;
      }
      downloadFile(csv, `evaluaciones_${Date.now()}.csv`, "text/csv");
      toast.success("CSV exportado");
    } catch {
      toast.error("Error al exportar");
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async () => {
    setExporting("excel");
    try {
      const base64 = await exportToExcel(getFilters());
      if (!base64) {
        toast.error("No hay datos para exportar");
        return;
      }
      const byteChars = atob(base64);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evaluaciones_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel exportado");
    } catch {
      toast.error("Error al exportar");
    } finally {
      setExporting(null);
    }
  };

  const handleExportJson = async () => {
    setExporting("json");
    try {
      const json = await exportToJson(getFilters());
      if (json === "[]") {
        toast.error("No hay datos para exportar");
        return;
      }
      downloadFile(json, `evaluaciones_${Date.now()}.json`, "application/json");
      toast.success("JSON exportado");
    } catch {
      toast.error("Error al exportar");
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Campaña</Label>
              <Select value={campaignId || "all"} onValueChange={(v) => v && setCampaignId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Todas">
                    {(value: string | null) => {
                      if (!value || value === "all") return "Todas";
                      return campaigns.find((c) => c.id === value)?.name ?? "Todas";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Formulario</Label>
              <Select value={formId || "all"} onValueChange={(v) => v && setFormId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Todos">
                    {(value: string | null) => {
                      if (!value || value === "all") return "Todos";
                      return filteredForms.find((f) => f.id === value)?.title ?? "Todos";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filteredForms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
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
              <p className="text-sm text-muted-foreground">
                Compatible con Excel y Google Sheets
              </p>
            </div>
            <Button
              onClick={handleExportCsv}
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
              <p className="text-sm text-muted-foreground">
                Datos estructurados para integración
              </p>
            </div>
            <Button
              onClick={handleExportJson}
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
              <p className="text-sm text-muted-foreground">
                Con formato, colores y filtros
              </p>
            </div>
            <Button
              onClick={handleExportExcel}
              disabled={exporting !== null}
              className="w-full"
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting === "excel" ? "Exportando..." : "Descargar Excel"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
