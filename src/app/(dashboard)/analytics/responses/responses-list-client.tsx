"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Award,
  ClipboardCheck,
  Filter,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getFilteredResponses } from "@/server/queries/analytics";
import type { AppSettings } from "@/lib/settings";

interface ResponseRow {
  id: string;
  score: number;
  createdAt: string;
  agent: { id: string; name: string; campaignName: string };
  evaluator: { id: string; name: string };
  form: { id: string; title: string };
  disposition: { id: string; name: string } | null;
}

interface ResponsesListData {
  responses: ResponseRow[];
  totalCount: number;
  shownCount: number;
  limit: number;
}

type StatusKey = "all" | "pass" | "fail" | "custom";

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function deriveStatus(
  min: number | undefined,
  max: number | undefined,
  threshold: number,
): StatusKey {
  if (min === undefined && max === undefined) return "all";
  if (min === threshold && max === undefined) return "pass";
  if (min === undefined && max !== undefined && max < threshold) return "fail";
  return "custom";
}

export function ResponsesListClient({
  settings,
  campaigns,
  initialMinScore,
  initialMaxScore,
  initialCampaignId,
  initialDateFrom,
  initialDateTo,
}: {
  settings: AppSettings;
  campaigns: { id: string; name: string }[];
  initialMinScore?: string;
  initialMaxScore?: string;
  initialCampaignId?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
}) {
  const router = useRouter();
  const threshold = settings.passThreshold;

  const [minScore, setMinScore] = useState<number | undefined>(
    parseNumber(initialMinScore),
  );
  const [maxScore, setMaxScore] = useState<number | undefined>(
    parseNumber(initialMaxScore),
  );
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? "");
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");
  const [data, setData] = useState<ResponsesListData | null>(null);
  const [loading, setLoading] = useState(true);

  const status = useMemo(
    () => deriveStatus(minScore, maxScore, threshold),
    [minScore, maxScore, threshold],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getFilteredResponses({
        minScore,
        maxScore,
        campaignId: campaignId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [minScore, maxScore, campaignId, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync filters → URL (so users can bookmark / share)
  useEffect(() => {
    const params = new URLSearchParams();
    if (minScore !== undefined) params.set("minScore", String(minScore));
    if (maxScore !== undefined) params.set("maxScore", String(maxScore));
    if (campaignId) params.set("campaignId", campaignId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const qs = params.toString();
    router.replace(qs ? `/analytics/responses?${qs}` : "/analytics/responses", {
      scroll: false,
    });
  }, [minScore, maxScore, campaignId, dateFrom, dateTo, router]);

  const handleStatusChange = (next: StatusKey) => {
    if (next === "all") {
      setMinScore(undefined);
      setMaxScore(undefined);
    } else if (next === "pass") {
      setMinScore(threshold);
      setMaxScore(undefined);
    } else if (next === "fail") {
      setMinScore(undefined);
      setMaxScore(threshold - 0.01);
    }
    // "custom" keeps whatever is there
  };

  const activeCampaignName = campaignId
    ? campaigns.find((c) => c.id === campaignId)?.name
    : null;

  const statusLabel =
    status === "pass"
      ? `Pass (≥${threshold}%)`
      : status === "fail"
        ? `Fail (<${threshold}%)`
        : status === "custom"
          ? `Rango ${minScore ?? 0}–${maxScore ?? 100}%`
          : "Todas";

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>

        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20">
                  <ClipboardCheck className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Evaluaciones</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Lista filtrable de evaluaciones. Click en una fila para ver el detalle.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t pt-4">
                <div>
                  <Label className="text-xs">Estado</Label>
                  <Select value={status} onValueChange={(v) => handleStatusChange(v as StatusKey)}>
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="pass">Solo Pass</SelectItem>
                      <SelectItem value="fail">Solo Fail</SelectItem>
                      <SelectItem value="custom">Rango personalizado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {status === "custom" && (
                  <>
                    <div>
                      <Label className="text-xs">Score mín</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={minScore ?? ""}
                        onChange={(e) =>
                          setMinScore(parseNumber(e.target.value))
                        }
                        className="h-8 w-24"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Score máx</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={maxScore ?? ""}
                        onChange={(e) =>
                          setMaxScore(parseNumber(e.target.value))
                        }
                        className="h-8 w-24"
                      />
                    </div>
                  </>
                )}

                {campaigns.length > 1 && (
                  <div>
                    <Label className="text-xs">Campaña</Label>
                    <Select
                      value={campaignId || "all"}
                      onValueChange={(v) =>
                        setCampaignId(v === "all" || !v ? "" : v)
                      }
                    >
                      <SelectTrigger className="h-8 w-44">
                        <SelectValue />
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
                )}

                <div>
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-8 w-36"
                  />
                </div>
                <div>
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-8 w-36"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Mostrando</span>
            {loading ? (
              <Skeleton className="h-5 w-32" />
            ) : data ? (
              <>
                <span className="font-semibold tabular-nums">
                  {data.shownCount === data.totalCount
                    ? data.totalCount
                    : `${data.shownCount} de ${data.totalCount}`}
                </span>
                <span className="text-muted-foreground">
                  {data.totalCount === 1 ? "evaluación" : "evaluaciones"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            <Badge
              variant={
                status === "pass"
                  ? "default"
                  : status === "fail"
                    ? "destructive"
                    : "secondary"
              }
              className="gap-1"
            >
              {status === "pass" && <TrendingUp className="h-3 w-3" />}
              {status === "fail" && <TrendingDown className="h-3 w-3" />}
              {status === "all" && <Award className="h-3 w-3" />}
              {statusLabel}
            </Badge>
            {activeCampaignName && (
              <Badge variant="secondary">{activeCampaignName}</Badge>
            )}
            {(dateFrom || dateTo) && (
              <Badge variant="outline">
                {dateFrom || "…"} → {dateTo || "hoy"}
              </Badge>
            )}
            {data && data.shownCount < data.totalCount && (
              <span className="ml-auto text-xs text-muted-foreground">
                Mostrando las {data.limit} más recientes. Refina los filtros para ver
                menos.
              </span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2 pt-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : data && data.responses.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente</TableHead>
                  <TableHead>Evaluador</TableHead>
                  <TableHead>Formulario</TableHead>
                  <TableHead>Disposición</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.responses.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/analytics/responses/${r.id}`)}
                  >
                    <TableCell className="font-medium">{r.agent.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.evaluator.name}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">
                      {r.form.title}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.disposition?.name ?? (
                        <span className="italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={scoreBadgeVariant(r.score)}
                        className="tabular-nums"
                      >
                        {r.score.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("es-ES", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              Sin evaluaciones para estos filtros
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
