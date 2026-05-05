"use client";

import { useState, useEffect } from "react";
import { getReportData } from "@/server/queries/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Eye } from "lucide-react";

interface ReportResponse {
  id: string;
  formTitle: string;
  agentName: string;
  agentCode: string | null;
  evaluatorName: string;
  score: number;
  createdAt: string;
  answers: { question: string; questionType: string; value: string }[];
}

interface ReportsClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
}

export function ReportsClient({ campaigns, forms }: ReportsClientProps) {
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [responses, setResponses] = useState<ReportResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<ReportResponse | null>(null);

  const filteredForms = campaignId
    ? forms.filter((f) => f.campaignId === campaignId)
    : forms;

  const handleSearch = async () => {
    setLoading(true);
    try {
      const data = await getReportData({
        campaignId: campaignId || undefined,
        formId: formId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setResponses(data);
    } catch {
      setResponses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadReports = async () => {
      setLoading(true);
      try {
        const data = await getReportData({});
        setResponses(data);
      } catch {
        setResponses([]);
      } finally {
        setLoading(false);
      }
    };

    void loadReports();
  }, []);

  const totalResponses = responses.length;
  const avgScore =
    totalResponses > 0
      ? responses.reduce((sum, r) => sum + r.score, 0) / totalResponses
      : 0;
  const passCount = responses.filter((r) => r.score >= 80).length;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Reportes</h1>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Campaña</Label>
              <Select
                value={campaignId || "all"}
                onValueChange={(v) => {
                  if (!v) return;
                  setCampaignId(v === "all" ? "" : v);
                  setFormId("");
                }}
              >
                <SelectTrigger className="w-44">
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
                <SelectTrigger className="w-52">
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
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={handleSearch} disabled={loading}>
              <Search className="mr-1 h-4 w-4" />
              {loading ? "Buscando..." : "Buscar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Evaluaciones</p>
            <p className="text-2xl font-bold">{totalResponses}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Score Promedio</p>
            <p className="text-2xl font-bold">{avgScore.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Pass Rate</p>
            <p className="text-2xl font-bold">
              {totalResponses > 0 ? Math.round((passCount / totalResponses) * 100) : 0}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Formulario</TableHead>
            <TableHead>Agente</TableHead>
            <TableHead>Evaluador</TableHead>
            <TableHead>Score</TableHead>
            <TableHead className="w-16">Detalle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {responses.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString("es-ES")}
              </TableCell>
              <TableCell>{r.formTitle}</TableCell>
              <TableCell>
                {r.agentName}
                {r.agentCode && (
                  <span className="ml-1 text-xs text-muted-foreground">({r.agentCode})</span>
                )}
              </TableCell>
              <TableCell>{r.evaluatorName}</TableCell>
              <TableCell>
                <Badge variant={r.score >= 80 ? "default" : "destructive"}>
                  {r.score.toFixed(1)}%
                </Badge>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon-xs" onClick={() => setSelectedResponse(r)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {responses.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                {loading ? "Cargando..." : "Sin resultados"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Detail Dialog */}
      <Dialog open={!!selectedResponse} onOpenChange={() => setSelectedResponse(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle de Evaluación</DialogTitle>
          </DialogHeader>
          {selectedResponse && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Formulario: </span>
                  {selectedResponse.formTitle}
                </div>
                <div>
                  <span className="text-muted-foreground">Score: </span>
                  <Badge variant={selectedResponse.score >= 80 ? "default" : "destructive"}>
                    {selectedResponse.score.toFixed(1)}%
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Agente: </span>
                  {selectedResponse.agentName}
                </div>
                <div>
                  <span className="text-muted-foreground">Evaluador: </span>
                  {selectedResponse.evaluatorName}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Fecha: </span>
                  {new Date(selectedResponse.createdAt).toLocaleString("es-ES")}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Respuestas</p>
                {selectedResponse.answers.map((a, i) => (
                  <div key={i} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{a.question}</p>
                    <p className="text-muted-foreground">
                      {a.questionType === "RATING" ? `${a.value}/5 ★` : a.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
