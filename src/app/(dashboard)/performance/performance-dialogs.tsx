"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  addOperationalCalendarDays,
  formatOperationalDate,
  useOperationalTimeZone,
} from "@/components/providers/operational-time-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addPipReview,
  approvePipPlan,
  closePipPlan,
  createCoachingSession,
  createPipPlan,
  recordCoachingAcknowledgement,
  recordPipAcknowledgement,
  submitPipForApproval,
} from "@/server/actions/performance-management";
import type { PerformanceWorkspaceData } from "@/server/queries/performance-management";

type WorkspaceData = PerformanceWorkspaceData;

function optionalIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function calendarIso(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function optionLabel(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function NewCoachingDialog({ data, onSaved }: { data: WorkspaceData; onSaved: () => void }) {
  const { t } = useI18n();
  const campaigns = data.campaigns.filter((campaign) => campaign.canManageCoaching);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [agentId, setAgentId] = useState("");
  const [responseId, setResponseId] = useState("");
  const [source, setSource] = useState("MANUAL");
  const filteredAgents = useMemo(
    () => data.agents.filter((agent) => agent.campaignId === campaignId),
    [campaignId, data.agents],
  );
  const filteredEvaluations = useMemo(
    () =>
      data.recentEvaluations.filter(
        (evaluation) =>
          evaluation.campaignId === campaignId && (!agentId || evaluation.agentId === agentId),
      ),
    [agentId, campaignId, data.recentEvaluations],
  );

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await createCoachingSession({
          campaignId,
          agentId,
          responseId: responseId || null,
          pipPlanId: null,
          title: String(formData.get("title") ?? ""),
          focusArea: String(formData.get("focusArea") ?? ""),
          behavior: String(formData.get("behavior") ?? "") || null,
          objective: String(formData.get("objective") ?? ""),
          source,
          scheduledAt: optionalIso(String(formData.get("scheduledAt") ?? "")),
          acknowledgementDueAt: optionalIso(String(formData.get("acknowledgementDueAt") ?? "")),
          followUpAt: optionalIso(String(formData.get("followUpAt") ?? "")),
          actionItems: String(formData.get("actionItem") ?? "").trim()
            ? [
                {
                  description: String(formData.get("actionItem")),
                  ownerType: "AGENT",
                  dueAt: optionalIso(String(formData.get("actionDueAt") ?? "")),
                },
              ]
            : [],
        });
        toast.success(t("Coaching session created"));
        setOpen(false);
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to create coaching")));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>{t("New coaching")}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("New coaching")}</DialogTitle>
          <DialogDescription>
            {t("Create the first documented coaching session for this scope.")}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Campaign")}</Label>
              <Select
                value={campaignId}
                onValueChange={(value) => {
                  setCampaignId(value ?? "");
                  setAgentId("");
                  setResponseId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Select campaign")}>
                    {(value: string | null) =>
                      campaigns.find((campaign) => campaign.id === value)?.name ??
                      t("Select campaign")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agent")}</Label>
              <Select
                value={agentId}
                onValueChange={(value) => {
                  setAgentId(value ?? "");
                  setResponseId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Select agent")}>
                    {(value: string | null) =>
                      filteredAgents.find((agent) => agent.id === value)?.name ?? t("Select agent")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.agentCode ? ` (${agent.agentCode})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Optional evaluation")}</Label>
            <Select
              value={responseId || "none"}
              onValueChange={(value) => setResponseId(!value || value === "none" ? "" : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) =>
                    value === "none"
                      ? t("No linked evaluation")
                      : (filteredEvaluations.find((evaluation) => evaluation.id === value)
                          ?.agentName ?? t("No linked evaluation"))
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("No linked evaluation")}</SelectItem>
                {filteredEvaluations.map((evaluation) => (
                  <SelectItem key={evaluation.id} value={evaluation.id}>
                    {evaluation.formTitle} · {evaluation.score.toFixed(1)}%
                    {evaluation.hasFatalFail ? " · CF" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="coaching-title">{t("Title")}</Label>
              <Input id="coaching-title" name="title" required maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-focus">{t("Focus area")}</Label>
              <Input id="coaching-focus" name="focusArea" required maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-behavior">{t("Behavior")}</Label>
              <Input id="coaching-behavior" name="behavior" maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Source")}</Label>
              <Select value={source} onValueChange={(value) => setSource(value ?? "MANUAL")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => (value ? t(optionLabel(value)) : t("Other"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">{t("Other")}</SelectItem>
                  <SelectItem value="EVALUATION">{t("Evaluations")}</SelectItem>
                  <SelectItem value="TREND">{t("Performance")}</SelectItem>
                  <SelectItem value="CRITICAL_FAILURE">Critical failure</SelectItem>
                  <SelectItem value="CALIBRATION">{t("Calibration")}</SelectItem>
                  <SelectItem value="PIP_REVIEW">{t("Improvement plans")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coaching-objective">{t("Objective")}</Label>
            <Textarea id="coaching-objective" name="objective" required rows={4} maxLength={5000} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="coaching-scheduled">{t("Schedule date")}</Label>
              <Input id="coaching-scheduled" name="scheduledAt" type="datetime-local" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-ack-due">{t("Acknowledgement due")}</Label>
              <Input id="coaching-ack-due" name="acknowledgementDueAt" type="datetime-local" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-follow-up">{t("Follow-up date")}</Label>
              <Input id="coaching-follow-up" name="followUpAt" type="datetime-local" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
            <div className="space-y-1.5">
              <Label htmlFor="coaching-action">{t("Initial action item")}</Label>
              <Input id="coaching-action" name="actionItem" maxLength={2000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-action-due">{t("Action due date")}</Label>
              <Input id="coaching-action-due" name="actionDueAt" type="datetime-local" />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !campaignId || !agentId}>
              {pending ? t("Saving…") : t("Create coaching session")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AcknowledgementDialog({
  coachingSessionId,
  onSaved,
}: {
  coachingSessionId: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"ACKNOWLEDGED" | "REFUSED">("ACKNOWLEDGED");
  const [method, setMethod] = useState("IN_PERSON");

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await recordCoachingAcknowledgement({
          coachingSessionId,
          status,
          method: status === "REFUSED" ? "WITNESSED" : method,
          comment: String(formData.get("comment") ?? "") || null,
        });
        toast.success(t("Acknowledgement recorded"));
        setOpen(false);
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to update the timer")));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {t("Record acknowledgement")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Record acknowledgement")}</DialogTitle>
          <DialogDescription>{t("Acknowledgement status")}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Status")}</Label>
              <Select
                value={status}
                onValueChange={(value) => {
                  const next = value === "REFUSED" ? "REFUSED" : "ACKNOWLEDGED";
                  setStatus(next);
                  if (next === "REFUSED") setMethod("WITNESSED");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => (value ? t(optionLabel(value)) : t("Pending"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACKNOWLEDGED">{t("Acknowledged")}</SelectItem>
                  <SelectItem value="REFUSED">{t("Refused")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Method")}</Label>
              <Select
                value={status === "REFUSED" ? "WITNESSED" : method}
                disabled={status === "REFUSED"}
                onValueChange={(value) => setMethod(value ?? "IN_PERSON")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => (value ? t(optionLabel(value)) : t("In person"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_PERSON">{t("In person")}</SelectItem>
                  <SelectItem value="SECURE_LINK">{t("Secure link")}</SelectItem>
                  <SelectItem value="EMAIL">{t("Email")}</SelectItem>
                  <SelectItem value="COMPANY_SYSTEM">{t("Company system")}</SelectItem>
                  <SelectItem value="WITNESSED">{t("Witnessed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ack-comment-${coachingSessionId}`}>{t("Comment")}</Label>
            <Textarea
              id={`ack-comment-${coachingSessionId}`}
              name="comment"
              rows={4}
              required={status === "REFUSED"}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t("Saving…") : t("Save acknowledgement")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewPipDialog({ data, onSaved }: { data: WorkspaceData; onSaved: () => void }) {
  const { t } = useI18n();
  const operationalTimeZone = useOperationalTimeZone();
  const campaigns = data.campaigns.filter((campaign) => campaign.canManagePips);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [agentId, setAgentId] = useState("");
  const [templateKey, setTemplateKey] = useState("PARKER_DAVIS");
  const [goalSlots, setGoalSlots] = useState([0]);
  const [criticalGoals, setCriticalGoals] = useState<Set<number>>(() => new Set());
  const today = formatOperationalDate(new Date(), operationalTimeZone);
  const end = addOperationalCalendarDays(today, 30);
  const filteredAgents = data.agents.filter((agent) => agent.campaignId === campaignId);

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await createPipPlan({
          campaignId,
          agentId,
          title: String(formData.get("title") ?? ""),
          templateKey,
          reason: String(formData.get("reason") ?? ""),
          objective: String(formData.get("objective") ?? ""),
          baselineSummary: String(formData.get("baselineSummary") ?? "") || null,
          supportSummary: String(formData.get("supportSummary") ?? "") || null,
          consequences: String(formData.get("consequences") ?? "") || null,
          reviewFrequency: String(formData.get("reviewFrequency") ?? "") || null,
          startDate: calendarIso(String(formData.get("startDate") ?? "")),
          targetEndDate: calendarIso(String(formData.get("targetEndDate") ?? "")),
          midpointDate: formData.get("midpointDate")
            ? calendarIso(String(formData.get("midpointDate")))
            : null,
          finalReviewDate: formData.get("finalReviewDate")
            ? calendarIso(String(formData.get("finalReviewDate")))
            : null,
          goals: goalSlots.map((slot) => ({
            area: String(formData.get(`goalArea-${slot}`) ?? ""),
            baseline: String(formData.get(`goalBaseline-${slot}`) ?? ""),
            target: String(formData.get(`goalTarget-${slot}`) ?? ""),
            dataSource: String(formData.get(`dataSource-${slot}`) ?? ""),
            measurementPeriod: String(formData.get(`measurementPeriod-${slot}`) ?? "") || null,
            measurementMethod: String(formData.get(`measurementMethod-${slot}`) ?? "") || null,
            sustainabilityPeriod:
              String(formData.get(`sustainabilityPeriod-${slot}`) ?? "") || null,
            isCritical: criticalGoals.has(slot),
          })),
        });
        toast.success(t("PIP draft created"));
        setOpen(false);
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to create PIP")));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>{t("New PIP")}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("New PIP")}</DialogTitle>
          <DialogDescription>{t("Only QA Managers can approve or close a PIP.")}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t("Campaign")}</Label>
              <Select
                value={campaignId}
                onValueChange={(value) => {
                  setCampaignId(value ?? "");
                  setAgentId("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Select campaign")}>
                    {(value: string | null) =>
                      campaigns.find((campaign) => campaign.id === value)?.name ??
                      t("Select campaign")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agent")}</Label>
              <Select value={agentId} onValueChange={(value) => setAgentId(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Select agent")}>
                    {(value: string | null) =>
                      filteredAgents.find((agent) => agent.id === value)?.name ?? t("Select agent")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Template")}</Label>
              <Select
                value={templateKey}
                onValueChange={(value) => setTemplateKey(value ?? "CUSTOM")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => {
                      if (value === "PARKER_DAVIS") return t("Parker Davis official");
                      if (value === "HAPUSA") return t("HAPUSA industry baseline");
                      return t("Custom");
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PARKER_DAVIS">{t("Parker Davis official")}</SelectItem>
                  <SelectItem value="HAPUSA">{t("HAPUSA industry baseline")}</SelectItem>
                  <SelectItem value="CUSTOM">{t("Custom")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pip-title">{t("Title")}</Label>
            <Input id="pip-title" name="title" required maxLength={160} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pip-reason">{t("Reason")}</Label>
            <Textarea id="pip-reason" name="reason" required rows={4} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pip-objective">{t("Objective")}</Label>
            <Textarea id="pip-objective" name="objective" required rows={3} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pip-baseline-summary">{t("Baseline summary")}</Label>
              <Textarea id="pip-baseline-summary" name="baselineSummary" rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-support">{t("Company support")}</Label>
              <Textarea id="pip-support" name="supportSummary" rows={3} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="pip-start">{t("Start date")}</Label>
              <Input id="pip-start" name="startDate" type="date" defaultValue={today} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-end">{t("Target end date")}</Label>
              <Input id="pip-end" name="targetEndDate" type="date" defaultValue={end} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-midpoint">{t("Midpoint date")}</Label>
              <Input id="pip-midpoint" name="midpointDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-final-review">{t("Final review date")}</Label>
              <Input id="pip-final-review" name="finalReviewDate" type="date" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pip-frequency">{t("Review frequency")}</Label>
              <Input id="pip-frequency" name="reviewFrequency" placeholder="Weekly" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-consequences">{t("Consequences")}</Label>
              <Input id="pip-consequences" name="consequences" />
            </div>
          </div>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">{t("Measurable goals")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("Add up to five SMART goals from the official plan.")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={goalSlots.length >= 5}
                onClick={() =>
                  setGoalSlots((slots) => [
                    ...slots,
                    slots.length === 0 ? 0 : Math.max(...slots) + 1,
                  ])
                }
              >
                <Plus data-icon="inline-start" />
                {t("Add goal")}
              </Button>
            </div>
            {goalSlots.map((slot, index) => (
              <div key={slot} className="space-y-4 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-medium">
                    {t("Goal")} {index + 1}
                  </h4>
                  {goalSlots.length > 1 && index === goalSlots.length - 1 ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Remove goal")}
                      onClick={() => {
                        setGoalSlots((slots) => slots.filter((item) => item !== slot));
                        setCriticalGoals((current) => {
                          const next = new Set(current);
                          next.delete(slot);
                          return next;
                        });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`pip-goal-area-${slot}`}>{t("Area")}</Label>
                    <Input id={`pip-goal-area-${slot}`} name={`goalArea-${slot}`} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pip-data-source-${slot}`}>{t("Data source")}</Label>
                    <Input id={`pip-data-source-${slot}`} name={`dataSource-${slot}`} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pip-goal-baseline-${slot}`}>{t("Baseline")}</Label>
                    <Textarea
                      id={`pip-goal-baseline-${slot}`}
                      name={`goalBaseline-${slot}`}
                      required
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pip-goal-target-${slot}`}>{t("Target")}</Label>
                    <Textarea
                      id={`pip-goal-target-${slot}`}
                      name={`goalTarget-${slot}`}
                      required
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pip-measurement-period-${slot}`}>
                      {t("Measurement period")}
                    </Label>
                    <Input
                      id={`pip-measurement-period-${slot}`}
                      name={`measurementPeriod-${slot}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pip-sustainability-${slot}`}>
                      {t("Sustainability period")}
                    </Label>
                    <Input
                      id={`pip-sustainability-${slot}`}
                      name={`sustainabilityPeriod-${slot}`}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`pip-measurement-method-${slot}`}>
                    {t("Measurement method")}
                  </Label>
                  <Textarea
                    id={`pip-measurement-method-${slot}`}
                    name={`measurementMethod-${slot}`}
                    rows={2}
                  />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`pip-critical-goal-${slot}`}
                    checked={criticalGoals.has(slot)}
                    onCheckedChange={(checked) =>
                      setCriticalGoals((current) => {
                        const next = new Set(current);
                        if (checked) next.add(slot);
                        else next.delete(slot);
                        return next;
                      })
                    }
                  />
                  <Label htmlFor={`pip-critical-goal-${slot}`}>{t("Critical goal")}</Label>
                </div>
              </div>
            ))}
          </section>

          <DialogFooter>
            <Button type="submit" disabled={pending || !campaignId || !agentId}>
              {pending ? t("Saving…") : t("Create PIP draft")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PipLifecycleButtons({
  pip,
  isAdmin,
  onSaved,
}: {
  pip: WorkspaceData["pipPlans"][number];
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<unknown>, success: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(t(success));
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to update PIP")));
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {pip.status === "DRAFT" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => submitPipForApproval({ pipPlanId: pip.id }), "PIP submitted for approval")
          }
        >
          {t("Submit for approval")}
        </Button>
      ) : null}
      {pip.status === "PENDING_APPROVAL" && isAdmin ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => approvePipPlan({ pipPlanId: pip.id }), "PIP approved and activated")
          }
        >
          {t("Approve and activate")}
        </Button>
      ) : null}
      {["ACTIVE", "ON_HOLD", "EXTENDED"].includes(pip.status) ? (
        <>
          {pip.acknowledgementStatus === "PENDING" ? (
            <PipAcknowledgementDialog pipPlanId={pip.id} onSaved={onSaved} />
          ) : null}
          <PipReviewDialog pip={pip} onSaved={onSaved} />
          {isAdmin ? (
            <>
              <PipCloseDialog pipPlanId={pip.id} successful onSaved={onSaved} />
              <PipCloseDialog pipPlanId={pip.id} successful={false} onSaved={onSaved} />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PipAcknowledgementDialog({
  pipPlanId,
  onSaved,
}: {
  pipPlanId: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("ACKNOWLEDGED");
  const [method, setMethod] = useState("IN_PERSON");

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await recordPipAcknowledgement({
          pipPlanId,
          status,
          method: status === "REFUSED" ? "WITNESSED" : method,
          comment: String(formData.get("comment") ?? "") || null,
        });
        toast.success(t("PIP acknowledgement recorded"));
        setOpen(false);
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to record acknowledgement")));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {t("Record acknowledgement")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("PIP acknowledgement")}</DialogTitle>
          <DialogDescription>
            {t(
              "Record receipt or a witnessed refusal. Receipt does not necessarily mean agreement.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Acknowledgement status")}</Label>
              <Select
                value={status}
                onValueChange={(value) => {
                  const next = value ?? "ACKNOWLEDGED";
                  setStatus(next);
                  if (next === "REFUSED") setMethod("WITNESSED");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => (value ? t(optionLabel(value)) : t("Pending"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACKNOWLEDGED">{t("Acknowledged")}</SelectItem>
                  <SelectItem value="REFUSED">{t("Refused")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Method")}</Label>
              <Select
                value={method}
                disabled={status === "REFUSED"}
                onValueChange={(value) => setMethod(value ?? "IN_PERSON")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => (value ? t(optionLabel(value)) : t("In person"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_PERSON">{t("In person")}</SelectItem>
                  <SelectItem value="SECURE_LINK">{t("Secure link")}</SelectItem>
                  <SelectItem value="EMAIL">{t("Email")}</SelectItem>
                  <SelectItem value="COMPANY_SYSTEM">{t("Company system")}</SelectItem>
                  <SelectItem value="WITNESSED">{t("Witnessed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pip-ack-comment-${pipPlanId}`}>{t("Comment")}</Label>
            <Textarea
              id={`pip-ack-comment-${pipPlanId}`}
              name="comment"
              rows={4}
              required={status === "REFUSED"}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t("Saving…") : t("Save acknowledgement")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PipReviewDialog({
  pip,
  onSaved,
}: {
  pip: WorkspaceData["pipPlans"][number];
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState("ON_TRACK");
  const [goalStatuses, setGoalStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(pip.goals.map((goal) => [goal.id, goal.status])),
  );

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await addPipReview({
          pipPlanId: pip.id,
          outcome,
          summary: String(formData.get("summary") ?? ""),
          barriers: String(formData.get("barriers") ?? "") || null,
          supportProvided: String(formData.get("supportProvided") ?? "") || null,
          nextSteps: String(formData.get("nextSteps") ?? "") || null,
          goalUpdates: pip.goals.flatMap((goal) => {
            const currentResult = String(formData.get(`goal-result-${goal.id}`) ?? "").trim();
            return currentResult
              ? [
                  {
                    goalId: goal.id,
                    currentResult,
                    status: goalStatuses[goal.id] ?? goal.status,
                  },
                ]
              : [];
          }),
        });
        toast.success(t("PIP review recorded"));
        setOpen(false);
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to update PIP")));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {t("Add review")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Record PIP review")}</DialogTitle>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("Outcome")}</Label>
            <Select value={outcome} onValueChange={(value) => setOutcome(value ?? "ON_TRACK")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => (value ? t(optionLabel(value)) : t("On Track"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ON_TRACK">On track</SelectItem>
                <SelectItem value="AT_RISK">At risk</SelectItem>
                <SelectItem value="IMPROVED">Improved</SelectItem>
                <SelectItem value="NO_PROGRESS">No progress</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pip-review-summary-${pip.id}`}>{t("Summary")}</Label>
            <Textarea id={`pip-review-summary-${pip.id}`} name="summary" required rows={4} />
          </div>
          <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div>
              <h3 className="font-medium">{t("Goal progress")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("Document the current result for every goal measured in this review.")}
              </p>
            </div>
            {pip.goals.map((goal) => (
              <div key={goal.id} className="grid gap-3 rounded-lg bg-background p-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`pip-review-goal-${goal.id}`}>{goal.area}</Label>
                  <Input
                    id={`pip-review-goal-${goal.id}`}
                    name={`goal-result-${goal.id}`}
                    defaultValue={goal.currentResult ?? ""}
                    placeholder={t("Current documented result")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Goal status")}</Label>
                  <Select
                    value={goalStatuses[goal.id] ?? goal.status}
                    onValueChange={(value) =>
                      setGoalStatuses((current) => ({
                        ...current,
                        [goal.id]: value ?? goal.status,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(value: string | null) => (value ? t(optionLabel(value)) : t("Pending"))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">{t("Pending")}</SelectItem>
                      <SelectItem value="ON_TRACK">{t("On Track")}</SelectItem>
                      <SelectItem value="AT_RISK">{t("At Risk")}</SelectItem>
                      <SelectItem value="MET">{t("Met")}</SelectItem>
                      <SelectItem value="NOT_MET">{t("Not Met")}</SelectItem>
                      <SelectItem value="NOT_APPLICABLE">{t("Not Applicable")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Barriers")}</Label>
              <Textarea name="barriers" rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Support provided")}</Label>
              <Textarea name="supportProvided" rows={3} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("Next steps")}</Label>
            <Textarea name="nextSteps" rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t("Saving…") : t("Record PIP review")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PipCloseDialog({
  pipPlanId,
  successful,
  onSaved,
}: {
  pipPlanId: string;
  successful: boolean;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = successful ? "Close successful" : "Close unsuccessful";

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await closePipPlan({
          pipPlanId,
          successful,
          closureSummary: String(formData.get("closureSummary") ?? ""),
        });
        toast.success(t("PIP closed"));
        setOpen(false);
        onSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to update PIP")));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={successful ? "outline" : "destructive"} />}>
        {t(label)}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(label)}</DialogTitle>
          <DialogDescription>{t("Confirm PIP closure")}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`pip-close-${pipPlanId}-${successful}`}>{t("Closure summary")}</Label>
            <Textarea
              id={`pip-close-${pipPlanId}-${successful}`}
              name="closureSummary"
              required
              rows={5}
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              variant={successful ? "default" : "destructive"}
              disabled={pending}
            >
              {pending ? t("Saving…") : t("Confirm PIP closure")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
