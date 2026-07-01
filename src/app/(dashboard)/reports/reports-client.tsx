"use client";

import { useState, useEffect } from "react";
import { getReportData } from "@/server/queries/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  campaignId: string;
  campaignName: string;
  formTitle: string;
  agentName: string;
  agentCode: string | null;
  evaluatorName: string;
  score: number;
  result: string | null;
  hasFatalFail: boolean;
  passThreshold: number;
  targetPassRate: number;
  targetAvgScore: number;
  targetDailyRate: number;
  fatalFailuresAllowed: number;
  passesThreshold: boolean;
  scoreTargetDelta: number;
  createdAt: string;
  answers: {
    question: string;
    questionType: string;
    value: string;
    category: { id: string; name: string; color: string | null; icon: string | null } | null;
    score: number | null;
    comment: string | null;
    isFatalFail: boolean;
    questionWeight: number;
    fatal: boolean;
    requiresCommentOnFail: boolean;
  }[];
}

interface ReportsClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
}

function getRangeDays(dateFrom?: string, dateTo?: string) {
  if (dateFrom && dateTo) {
    return Math.max(
      1,
      Math.ceil(
        (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24),
      ) + 1,
    );
  }

  if (dateFrom) {
    return Math.max(
      1,
      Math.ceil((Date.now() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  return 30;
}

function aggregateTargets(responses: ReportResponse[]) {
  const totalResponses = responses.length;
  const campaignTargets = new Map<
    string,
    {
      targetPassRate: number;
      targetAvgScore: number;
      targetDailyRate: number;
      fatalFailuresAllowed: number;
    }
  >();

  for (const response of responses) {
    campaignTargets.set(response.campaignId, {
      targetPassRate: response.targetPassRate,
      targetAvgScore: response.targetAvgScore,
      targetDailyRate: response.targetDailyRate,
      fatalFailuresAllowed: response.fatalFailuresAllowed,
    });
  }

  const weightedAvg = (key: "targetPassRate" | "targetAvgScore") => {
    if (totalResponses === 0) return 0;
    return (
      Math.round(
        (responses.reduce((sum, response) => sum + response[key], 0) / totalResponses) * 100,
      ) / 100
    );
  };

  return {
    targetPassRate: weightedAvg("targetPassRate"),
    targetAvgScore: weightedAvg("targetAvgScore"),
    targetDailyRate: Array.from(campaignTargets.values()).reduce(
      (sum, target) => sum + target.targetDailyRate,
      0,
    ),
    fatalFailuresAllowed: Array.from(campaignTargets.values()).reduce(
      (sum, target) => sum + target.fatalFailuresAllowed,
      0,
    ),
  };
}

export function ReportsClient({ campaigns, forms }: ReportsClientProps) {
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [responses, setResponses] = useState<ReportResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<ReportResponse | null>(null);

  const filteredForms = campaignId ? forms.filter((f) => f.campaignId === campaignId) : forms;

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
    totalResponses > 0 ? responses.reduce((sum, r) => sum + r.score, 0) / totalResponses : 0;
  const passCount = responses.filter((r) => r.passesThreshold).length;
  const passRate = totalResponses > 0 ? Math.round((passCount / totalResponses) * 100) : 0;
  const fatalFailCount = responses.filter((r) => r.hasFatalFail).length;
  const dailyRate = Math.round((totalResponses / getRangeDays(dateFrom, dateTo)) * 100) / 100;
  const targets = aggregateTargets(responses);

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
              <Select
                value={formId || "all"}
                onValueChange={(v) => v && setFormId(v === "all" ? "" : v)}
              >
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Evaluaciones</p>
            <p className="text-2xl font-bold">{totalResponses}</p>
          </CardContent>
        </Card>
        <Card className={avgScore >= targets.targetAvgScore ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Score Promedio</p>
            <p className="text-2xl font-bold">{avgScore.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Target: {targets.targetAvgScore}%</p>
          </CardContent>
        </Card>
        <Card className={passRate >= targets.targetPassRate ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Pass Rate</p>
            <p className="text-2xl font-bold">{passRate}%</p>
            <p className="text-xs text-muted-foreground">Target: {targets.targetPassRate}%</p>
          </CardContent>
        </Card>
        <Card className={dailyRate >= targets.targetDailyRate ? "border-green-200" : "border-amber-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Tasa Diaria</p>
            <p className="text-2xl font-bold">{dailyRate.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Target: {targets.targetDailyRate}/día</p>
          </CardContent>
        </Card>
        <Card className={fatalFailCount <= targets.fatalFailuresAllowed ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Fatales</p>
            <p className="text-2xl font-bold">{fatalFailCount}</p>
            <p className="text-xs text-muted-foreground">Permitidas: {targets.fatalFailuresAllowed}</p>
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={r.passesThreshold ? "default" : "destructive"}>
                    {r.score.toFixed(1)}%
                  </Badge>
                  <Badge
                    variant={r.score >= r.targetAvgScore ? "outline" : "secondary"}
                    className="tabular-nums"
                  >
                    Target {r.scoreTargetDelta >= 0 ? "+" : ""}
                    {r.scoreTargetDelta.toFixed(1)}
                  </Badge>
                  {!r.passesThreshold && (
                    <Badge variant="destructive">{r.hasFatalFail ? "Fatal" : "Fail"}</Badge>
                  )}
                </div>
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
                  <Badge variant={selectedResponse.passesThreshold ? "default" : "destructive"}>
                    {selectedResponse.score.toFixed(1)}%
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Resultado: </span>
                  <Badge variant={selectedResponse.passesThreshold ? "default" : "destructive"}>
                    {selectedResponse.passesThreshold ? "PASS" : "FAIL"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Target score: </span>
                  {selectedResponse.targetAvgScore}%
                </div>
                <div>
                  <span className="text-muted-foreground">Umbral pass: </span>
                  {selectedResponse.passThreshold}%
                </div>
                <div>
                  <span className="text-muted-foreground">Falla fatal: </span>
                  {selectedResponse.hasFatalFail ? "Si" : "No"}
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
                {selectedResponse.answers.map((a) => (
                  <div key={`${a.question}-${a.value}`} className="rounded-lg border p-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {a.category && (
                          <Badge variant="outline" className="gap-1.5 text-xs">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: a.category.color ?? "#ff6600" }}
                            />
                            {a.category.name}
                          </Badge>
                        )}
                        {a.questionWeight > 0 && (
                          <Badge variant="outline" className="text-xs">
                            Peso {a.questionWeight}%
                          </Badge>
                        )}
                        {a.fatal && (
                          <Badge variant="destructive" className="text-xs">
                            Fatal
                          </Badge>
                        )}
                      </div>
                      {a.score !== null && (
                        <Badge
                          variant={
                            a.isFatalFail ? "destructive" : a.score >= 70 ? "default" : "secondary"
                          }
                          className="tabular-nums"
                        >
                          {a.score.toFixed(1)}%
                        </Badge>
                      )}
                    </div>
                    <p className="font-medium">{a.question}</p>
                    <p className="text-muted-foreground">
                      {a.questionType === "RATING" ? `${a.value} ★` : a.value}
                    </p>
                    {a.comment && (
                      <p className="mt-2 whitespace-pre-wrap border-l-2 border-orange-500/50 pl-2 text-xs text-muted-foreground">
                        {a.comment}
                      </p>
                    )}
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
