"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { AlertTriangle, CheckCircle2, TrendingDown, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getCampaignKpis, getScoreByQuestion, getEvaluatorActivity } from "@/server/queries/analytics";
import type { AppSettings } from "@/lib/settings";

interface CampaignKpi {
  id: string; name: string; totalForms: number; totalAgents: number;
  totalEvaluators: number; totalEvaluations: number; avgScore: number;
  passRate: number; dailyRate: number;
}

interface QuestionScore {
  question: string; avgScore: number; totalAnswers: number;
}

interface EvaluatorData {
  id: string; name: string; totalEvaluations: number;
  avgScore: number; stdDev: number;
}

// Brand-aligned palette: TNO orange + navy + supporting hues
const COLORS = ["#ff6600", "#1a2b45", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

export function KpisClient({ settings }: { settings: AppSettings }) {
  const TARGETS = {
    passRate: settings.targetPassRate,
    avgScore: settings.targetAvgScore,
    dailyRate: settings.targetDailyRate,
  };
  const passThreshold = settings.passThreshold;
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [kpis, setKpis] = useState<CampaignKpi[]>([]);
  const [questionScores, setQuestionScores] = useState<QuestionScore[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [k, qs, ev] = await Promise.all([
        getCampaignKpis(dateFrom || undefined, dateTo || undefined),
        getScoreByQuestion(undefined, dateFrom || undefined, dateTo || undefined),
        getEvaluatorActivity(dateFrom || undefined, dateTo || undefined),
      ]);
      setKpis(k);
      setQuestionScores(qs);
      setEvaluators(ev);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  const setQuickRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  if (loading && kpis.length === 0) {
    return <div className="flex h-[50vh] items-center justify-center text-muted-foreground">Cargando KPIs...</div>;
  }

  const totalEvaluations = kpis.reduce((sum, k) => sum + k.totalEvaluations, 0);
  const overallAvg = totalEvaluations > 0
    ? kpis.reduce((sum, k) => sum + k.avgScore * k.totalEvaluations, 0) / totalEvaluations : 0;
  const overallPassRate = totalEvaluations > 0
    ? Math.round(kpis.reduce((sum, k) => sum + (k.passRate / 100) * k.totalEvaluations, 0) / totalEvaluations * 100) : 0;
  const overallDailyRate = kpis.reduce((sum, k) => sum + k.dailyRate, 0);

  // Alerts
  const alerts: { type: "warning" | "success"; msg: string }[] = [];
  if (overallPassRate < TARGETS.passRate)
    alerts.push({ type: "warning", msg: `Pass Rate (${overallPassRate}%) por debajo del target (${TARGETS.passRate}%)` });
  else
    alerts.push({ type: "success", msg: `Pass Rate (${overallPassRate}%) cumple el target (${TARGETS.passRate}%)` });

  if (overallAvg < TARGETS.avgScore)
    alerts.push({ type: "warning", msg: `Score promedio (${overallAvg.toFixed(1)}%) por debajo del target (${TARGETS.avgScore}%)` });
  else
    alerts.push({ type: "success", msg: `Score promedio (${overallAvg.toFixed(1)}%) cumple el target (${TARGETS.avgScore}%)` });

  if (overallDailyRate < TARGETS.dailyRate)
    alerts.push({ type: "warning", msg: `Tasa diaria (${overallDailyRate.toFixed(1)}/día) por debajo del target (${TARGETS.dailyRate}/día)` });

  // Evaluator consistency alerts
  const inconsistentEvaluators = evaluators.filter((e) => e.stdDev > 20 && e.totalEvaluations >= 5);
  if (inconsistentEvaluators.length > 0) {
    alerts.push({
      type: "warning",
      msg: `${inconsistentEvaluators.length} evaluador(es) con alta variabilidad (±>20): ${inconsistentEvaluators.map((e) => e.name).join(", ")}`,
    });
  }

  const pieData = kpis.filter((k) => k.totalEvaluations > 0).map((k) => ({ name: k.name, value: k.totalEvaluations }));

  return (
    <div className="space-y-6">
      {/* Header + Date Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">KPIs por Campaña</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <Button key={d} variant="outline" size="sm" onClick={() => setQuickRange(d)}>{d}d</Button>
            ))}
            <Button variant="outline" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Todo</Button>
          </div>
          <div className="flex items-end gap-2">
            <div><Label className="text-xs">Desde</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36" /></div>
            <div><Label className="text-xs">Hasta</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36" /></div>
          </div>
        </div>
      </div>

      {/* KPI Summary with targets */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Total Evaluaciones</p>
            <p className="text-2xl font-bold">{totalEvaluations}</p>
          </CardContent>
        </Card>
        <Card className={overallAvg >= TARGETS.avgScore ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Score Global</p>
            <p className="text-2xl font-bold">{overallAvg.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Target: {TARGETS.avgScore}%</p>
          </CardContent>
        </Card>
        <Card className={overallPassRate >= TARGETS.passRate ? "border-green-200" : "border-red-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Pass Rate</p>
            <p className="text-2xl font-bold">{overallPassRate}%</p>
            <p className="text-xs text-muted-foreground">Target: {TARGETS.passRate}%</p>
          </CardContent>
        </Card>
        <Card className={overallDailyRate >= TARGETS.dailyRate ? "border-green-200" : "border-amber-200"}>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">Tasa Diaria</p>
            <p className="text-2xl font-bold">{overallDailyRate.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Target: {TARGETS.dailyRate}/día</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Alertas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-center gap-2 rounded-lg p-2 text-sm ${a.type === "warning" ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"}`}>
                {a.type === "warning" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                {a.msg}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Score Promedio por Campaña</CardTitle></CardHeader>
          <CardContent>
            {kpis.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={kpis} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis dataKey="name" type="category" width={120} className="text-xs" />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                  <Bar dataKey="avgScore" radius={[0, 4, 4, 0]}>
                    {kpis.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[300px] items-center justify-center text-muted-foreground">Sin datos</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Distribución de Evaluaciones</CardTitle></CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={(props) => `${props.name}: ${props.value}`}>
                    {pieData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[300px] items-center justify-center text-muted-foreground">Sin datos</div>}
          </CardContent>
        </Card>
      </div>

      {/* Score by Question */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="h-4 w-4" />
            Score por Pregunta (ordenado de menor a mayor)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {questionScores.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, questionScores.length * 40)}>
              <BarChart data={questionScores} layout="vertical" margin={{ left: 150 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis dataKey="question" type="category" width={145} className="text-xs" />
                <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                <Bar dataKey="avgScore" radius={[0, 4, 4, 0]}>
                  {questionScores.map((q, i) => (
                    <Cell key={i} fill={q.avgScore >= 80 ? "#22c55e" : q.avgScore >= 60 ? "#f59e0b" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex h-[200px] items-center justify-center text-muted-foreground">Sin datos de preguntas tipo RATING</div>}
        </CardContent>
      </Card>

      {/* Evaluator Activity */}
      <Card>
        <CardHeader><CardTitle className="text-base">Actividad de Evaluadores</CardTitle></CardHeader>
        <CardContent>
          {evaluators.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={evaluators.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-xs" angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip formatter={(value, name) => [name === "avgScore" ? `${Number(value).toFixed(1)}%` : value, name === "avgScore" ? "Score Promedio" : "Evaluaciones"]} />
                <Bar dataKey="totalEvaluations" fill="#ff6600" radius={[4, 4, 0, 0]} name="Evaluaciones" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex h-[300px] items-center justify-center text-muted-foreground">Sin datos</div>}
        </CardContent>
      </Card>

      {/* Campaign Detail Cards */}
      <h2 className="text-xl font-semibold">Detalle por Campaña</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <Card key={kpi.id} className={kpi.passRate < passThreshold ? "border-red-200" : ""}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{kpi.name}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-muted-foreground">Formularios</p><p className="font-medium">{kpi.totalForms}</p></div>
                <div><p className="text-muted-foreground">Agentes</p><p className="font-medium">{kpi.totalAgents}</p></div>
                <div><p className="text-muted-foreground">Evaluadores</p><p className="font-medium">{kpi.totalEvaluators}</p></div>
                <div><p className="text-muted-foreground">Evaluaciones</p><p className="font-medium">{kpi.totalEvaluations}</p></div>
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <p className="text-xs text-muted-foreground">Score</p>
                  <Badge variant={kpi.avgScore >= passThreshold ? "default" : "destructive"}>{kpi.avgScore.toFixed(1)}%</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pass Rate</p>
                  <Badge variant={kpi.passRate >= TARGETS.passRate ? "default" : kpi.passRate >= passThreshold ? "secondary" : "destructive"}>{kpi.passRate}%</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Diario</p>
                  <Badge variant="outline">{kpi.dailyRate.toFixed(1)}/d</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
