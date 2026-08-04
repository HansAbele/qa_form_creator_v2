"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTimePicker } from "@/components/filters/date-time-picker";
import { CreatableCombobox } from "@/components/forms/creatable-combobox";
import {
  type EvaluationEvidenceItem,
  EvaluationEvidencePicker,
} from "@/components/performance/evaluation-evidence-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  addOperationalCalendarDays,
  formatOperationalDate,
  useOperationalTimeZone,
} from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
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
  availablePipReviewFrequencies,
  type PipTemplateKey,
  pipPlanDurationDays,
} from "@/lib/performance-management";
import { recoverFromServerActionVersionSkew } from "@/lib/server-action-version-skew";
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

function showActionError(error: unknown, fallback: string) {
  if (recoverFromServerActionVersionSkew(error)) return;
  toast.error(error instanceof Error ? error.message : fallback);
}

function optionLabel(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function templateForCampaign(campaignName: string): PipTemplateKey {
  const normalizedName = campaignName.toLocaleLowerCase();
  if (normalizedName.includes("hapusa")) return "HAPUSA";
  if (normalizedName.includes("parker davis")) return "PARKER_DAVIS";
  return "CUSTOM";
}

function CampaignSelector({
  campaigns,
  value,
  onValueChange,
}: {
  campaigns: { id: string; name: string }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const { t } = useI18n();
  if (campaigns.length === 1) {
    return (
      <div className="flex min-h-10 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm">
        <span className="font-medium">{campaigns[0]?.name}</span>
        <Badge variant="secondary">{t("Automatic")}</Badge>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue ?? "")}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("Select campaign")}>
          {(selectedValue: string | null) =>
            campaigns.find((campaign) => campaign.id === selectedValue)?.name ??
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
  );
}

export function NewCoachingDialog({ data, onSaved }: { data: WorkspaceData; onSaved: () => void }) {
  const { t } = useI18n();
  const timeZone = useOperationalTimeZone();
  const today = formatOperationalDate(new Date(), timeZone);
  const campaigns = data.campaigns.filter((campaign) => campaign.canManageCoaching);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [agentId, setAgentId] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<EvaluationEvidenceItem[]>([]);
  const [focusArea, setFocusArea] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [acknowledgementDueAt, setAcknowledgementDueAt] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const filteredAgents = useMemo(
    () => data.agents.filter((agent) => agent.campaignId === campaignId),
    [campaignId, data.agents],
  );
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  const responseId = selectedEvidence[0]?.id ?? "";

  function submit(formData: FormData) {
    const startNow = formData.get("mode") === "now";
    startTransition(async () => {
      try {
        await createCoachingSession({
          campaignId,
          agentId,
          responseId,
          pipPlanId: null,
          focusArea,
          objective: String(formData.get("objective") ?? ""),
          scheduledAt: optionalIso(scheduledAt),
          acknowledgementDueAt: optionalIso(acknowledgementDueAt),
          followUpAt: optionalIso(followUpAt),
          startNow,
        });
        toast.success(t("Coaching session created"));
        setOpen(false);
        onSaved();
      } catch (error) {
        showActionError(error, t("Unable to create coaching"));
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
              <CampaignSelector
                campaigns={campaigns}
                value={campaignId}
                onValueChange={(value) => {
                  setCampaignId(value);
                  setAgentId("");
                  setSelectedEvidence([]);
                  setFocusArea("");
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agent")}</Label>
              <Select
                value={agentId}
                onValueChange={(value) => {
                  setAgentId(value ?? "");
                  setSelectedEvidence([]);
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
            <Label>{t("Evaluation evidence")}</Label>
            <EvaluationEvidencePicker
              campaignId={campaignId}
              agentId={agentId}
              scope="coaching"
              selectionMode="single"
              selected={selectedEvidence}
              onSelectionChange={setSelectedEvidence}
            />
            <p className="text-xs text-muted-foreground">
              {t("Choose one evaluated call so the agent can review the evidence and recording.")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coaching-focus">{t("Focus area")}</Label>
            <CreatableCombobox
              id="coaching-focus"
              value={focusArea}
              options={selectedCampaign?.focusAreas ?? []}
              onChange={setFocusArea}
              placeholder={t("Choose a scorecard category or type a custom focus area.")}
              searchPlaceholder={t("Search or add focus area")}
              customLabel={(value) => t("Use custom focus area: {value}", { value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coaching-objective">{t("Objective")}</Label>
            <Textarea id="coaching-objective" name="objective" required rows={4} maxLength={5000} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="coaching-scheduled">{t("Coaching time today")}</Label>
              <DateTimePicker
                id="coaching-scheduled"
                value={scheduledAt}
                onChange={setScheduledAt}
                fixedDate={today}
                placeholder={t("Select today's time")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-ack-due">{t("Acknowledgement due")}</Label>
              <DateTimePicker
                id="coaching-ack-due"
                value={acknowledgementDueAt}
                onChange={setAcknowledgementDueAt}
                placeholder={t("Select date and time")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coaching-follow-up">{t("Follow-up date")}</Label>
              <DateTimePicker
                id="coaching-follow-up"
                value={followUpAt}
                onChange={setFollowUpAt}
                placeholder={t("Select date and time")}
              />
            </div>
          </div>

          <DialogFooter>
            {selectedCampaign?.canTrackQaActivity ? (
              <Button
                type="submit"
                name="mode"
                value="now"
                variant="outline"
                disabled={pending || !campaignId || !agentId || !responseId || !focusArea}
              >
                {pending ? t("Saving…") : t("Coaching now")}
              </Button>
            ) : null}
            <Button
              type="submit"
              name="mode"
              value="today"
              disabled={
                pending || !campaignId || !agentId || !responseId || !focusArea || !scheduledAt
              }
            >
              {pending ? t("Saving…") : t("Create coaching for today")}
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
  agentSelfService = false,
}: {
  coachingSessionId: string;
  onSaved: () => void;
  agentSelfService?: boolean;
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
          method:
            agentSelfService && status === "ACKNOWLEDGED"
              ? "COMPANY_SYSTEM"
              : status === "REFUSED"
                ? "WITNESSED"
                : method,
          comment: String(formData.get("comment") ?? "") || null,
        });
        toast.success(t("Acknowledgement recorded"));
        setOpen(false);
        onSaved();
      } catch (error) {
        showActionError(error, t("Unable to update the timer"));
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
          <DialogDescription>
            {agentSelfService
              ? t("Confirm that you reviewed the coaching evidence and action plan.")
              : t("Acknowledgement status")}
          </DialogDescription>
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
            {!agentSelfService ? (
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
            ) : null}
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
  const [templateKey, setTemplateKey] = useState<PipTemplateKey>(() =>
    templateForCampaign(campaigns[0]?.name ?? ""),
  );
  const [goalSlots, setGoalSlots] = useState([0]);
  const [criticalGoals, setCriticalGoals] = useState<Set<number>>(() => new Set());
  const today = formatOperationalDate(new Date(), operationalTimeZone);
  const end = addOperationalCalendarDays(today, 30);
  const [startDate, setStartDate] = useState(today);
  const [targetEndDate, setTargetEndDate] = useState(end);
  const [midpointDate, setMidpointDate] = useState("");
  const [finalReviewDate, setFinalReviewDate] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<EvaluationEvidenceItem[]>([]);
  const [reviewFrequency, setReviewFrequency] = useState("Weekly");
  const [coachingSessionIds, setCoachingSessionIds] = useState<Set<string>>(() => new Set());
  const filteredAgents = data.agents.filter((agent) => agent.campaignId === campaignId);
  const filteredCoachings = data.coachingSessions.filter(
    (coaching) =>
      coaching.campaignId === campaignId &&
      coaching.agent.id === agentId &&
      coaching.pipPlanId === null,
  );
  const reviewFrequencyOptions = useMemo(
    () => availablePipReviewFrequencies(startDate, targetEndDate),
    [startDate, targetEndDate],
  );
  const planDurationDays = pipPlanDurationDays(startDate, targetEndDate);

  useEffect(() => {
    if (!reviewFrequencyOptions.some((frequency) => frequency === reviewFrequency)) {
      setReviewFrequency(reviewFrequencyOptions.at(-1) ?? "Daily");
    }
  }, [reviewFrequency, reviewFrequencyOptions]);

  const changeCampaign = (nextCampaignId: string) => {
    setCampaignId(nextCampaignId);
    setAgentId("");
    setSelectedEvidence([]);
    setCoachingSessionIds(new Set());
    const nextCampaign = campaigns.find((campaign) => campaign.id === nextCampaignId);
    setTemplateKey(templateForCampaign(nextCampaign?.name ?? ""));
  };

  const changeTemplate = (nextTemplateKey: PipTemplateKey) => {
    setTemplateKey(nextTemplateKey);
    setSelectedEvidence([]);
    const expectedCampaign =
      nextTemplateKey === "HAPUSA"
        ? campaigns.find((campaign) => campaign.name.toLocaleLowerCase().includes("hapusa"))
        : nextTemplateKey === "PARKER_DAVIS"
          ? campaigns.find((campaign) => campaign.name.toLocaleLowerCase().includes("parker davis"))
          : null;
    if (expectedCampaign && expectedCampaign.id !== campaignId) {
      setCampaignId(expectedCampaign.id);
      setAgentId("");
      setCoachingSessionIds(new Set());
    }
  };

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
          reviewFrequency,
          startDate: calendarIso(startDate),
          targetEndDate: calendarIso(targetEndDate),
          midpointDate: midpointDate ? calendarIso(midpointDate) : null,
          finalReviewDate: finalReviewDate ? calendarIso(finalReviewDate) : null,
          evidenceResponseIds: selectedEvidence.map((item) => item.id),
          coachingSessionIds: [...coachingSessionIds],
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
        showActionError(error, t("Unable to create PIP"));
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
              <CampaignSelector
                campaigns={campaigns}
                value={campaignId}
                onValueChange={changeCampaign}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agent")}</Label>
              <Select
                value={agentId}
                onValueChange={(value) => {
                  setAgentId(value ?? "");
                  setSelectedEvidence([]);
                  setCoachingSessionIds(new Set());
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
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Template")}</Label>
              <Select
                value={templateKey}
                onValueChange={(value) =>
                  changeTemplate((value as PipTemplateKey | null) ?? "CUSTOM")
                }
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

          <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <h3 className="font-medium">{t("Required supporting evidence")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("Select evaluations, calls, or prior coaching records reviewed for this PIP.")}
              </p>
            </div>
            {!agentId ? (
              <p className="text-sm text-muted-foreground">
                {t("Select an agent to load their evidence.")}
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("Evaluations and calls")}
                  </p>
                  <EvaluationEvidencePicker
                    campaignId={campaignId}
                    agentId={agentId}
                    scope="pip"
                    templateKey={templateKey}
                    selectionMode="multiple"
                    selected={selectedEvidence}
                    onSelectionChange={setSelectedEvidence}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("Prior coaching")}
                  </p>
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border bg-background p-3">
                    {filteredCoachings.map((coaching) => (
                      <div key={coaching.id} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          id={`pip-evidence-coaching-${coaching.id}`}
                          checked={coachingSessionIds.has(coaching.id)}
                          onCheckedChange={(checked) =>
                            setCoachingSessionIds((current) => {
                              const next = new Set(current);
                              if (checked) next.add(coaching.id);
                              else next.delete(coaching.id);
                              return next;
                            })
                          }
                        />
                        <label htmlFor={`pip-evidence-coaching-${coaching.id}`} className="min-w-0">
                          <span className="block truncate font-medium">{coaching.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {coaching.focusArea} · {coaching.evidence.length} {t("evidence items")}
                          </span>
                        </label>
                      </div>
                    ))}
                    {filteredCoachings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("No coaching records available.")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </section>

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
              <DateTimePicker
                id="pip-start"
                mode="date"
                value={startDate}
                onChange={setStartDate}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-end">{t("Target end date")}</Label>
              <DateTimePicker
                id="pip-end"
                mode="date"
                value={targetEndDate}
                onChange={setTargetEndDate}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-midpoint">{t("Midpoint date")}</Label>
              <DateTimePicker
                id="pip-midpoint"
                mode="date"
                value={midpointDate}
                onChange={setMidpointDate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pip-final-review">{t("Final review date")}</Label>
              <DateTimePicker
                id="pip-final-review"
                mode="date"
                value={finalReviewDate}
                onChange={setFinalReviewDate}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pip-frequency">{t("Review frequency")}</Label>
              <Select
                value={reviewFrequency}
                onValueChange={(value) => setReviewFrequency(value ?? "Daily")}
              >
                <SelectTrigger id="pip-frequency" className="w-full">
                  <SelectValue>{reviewFrequency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {reviewFrequencyOptions.map((frequency) => (
                    <SelectItem key={frequency} value={frequency}>
                      {frequency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("Available review cadence for a {days}-day plan.", {
                  days: planDurationDays,
                })}
              </p>
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
            <Button
              type="submit"
              disabled={
                pending ||
                !campaignId ||
                !agentId ||
                selectedEvidence.length + coachingSessionIds.size === 0
              }
            >
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
        showActionError(error, t("Unable to update PIP"));
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

export function PipAcknowledgementDialog({
  pipPlanId,
  onSaved,
  agentSelfService = false,
}: {
  pipPlanId: string;
  onSaved: () => void;
  agentSelfService?: boolean;
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
          method:
            agentSelfService && status === "ACKNOWLEDGED"
              ? "COMPANY_SYSTEM"
              : status === "REFUSED"
                ? "WITNESSED"
                : method,
          comment: String(formData.get("comment") ?? "") || null,
        });
        toast.success(t("PIP acknowledgement recorded"));
        setOpen(false);
        onSaved();
      } catch (error) {
        showActionError(error, t("Unable to record acknowledgement"));
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
            {agentSelfService
              ? t("Confirm that you reviewed the complete plan and its supporting evidence.")
              : t(
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
            {!agentSelfService ? (
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
            ) : null}
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
        showActionError(error, t("Unable to update PIP"));
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
        showActionError(error, t("Unable to update PIP"));
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
