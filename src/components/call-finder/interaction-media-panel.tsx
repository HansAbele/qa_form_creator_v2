"use client";

import {
  CloudDownload,
  Download,
  FileAudio,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  ScrollText,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  attachCallRecording,
  confirmTranscriptSpeakerRoles,
  transcribeCallRecording,
} from "@/server/actions/call-finder";

export type InteractionMediaContext = {
  id: string;
  provider: string;
  providerInteractionId: string;
  direction: string;
  phoneNumber: string | null;
  queueName: string | null;
  startedAt: string;
  durationSeconds: number;
  audioUrl: string | null;
  recordingExpected?: boolean;
  transcript: {
    id: string;
    provider: string;
    status: string;
    isDiarized: boolean;
    segments: {
      id: string;
      ordinal: number;
      startMs: number;
      endMs: number;
      speakerKey: string | null;
      speakerRole: string;
      text: string;
      confidence: number | null;
    }[];
  } | null;
  transcriptionJob?: {
    id: string;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    lastErrorCode: string | null;
  } | null;
};

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const rounded = Math.floor(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function speakerLabel(
  role: string,
  speakerKey: string | null,
  t: (message: string, values?: Record<string, string | number>) => string,
) {
  if (role === "AGENT") return t("Agent");
  if (role === "CUSTOMER") return t("Customer");
  return t("Speaker {speaker}", { speaker: speakerKey ?? "?" });
}

export function InteractionMediaPanel({
  interaction,
  compact = false,
  className,
}: {
  interaction: InteractionMediaContext;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(interaction.durationSeconds);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [speakerEditorOpen, setSpeakerEditorOpen] = useState(false);
  const [speakerAssignments, setSpeakerAssignments] = useState<Record<string, string>>({});
  const [recordingPending, startRecordingTransition] = useTransition();
  const [transcriptionPending, startTranscriptionTransition] = useTransition();
  const [speakerPending, startSpeakerTransition] = useTransition();
  const transcript = interaction.transcript;
  const transcriptionJob = interaction.transcriptionJob;
  const transcriptionActive =
    transcriptionJob?.status === "PENDING" || transcriptionJob?.status === "PROCESSING";
  const transcriptionFailed = transcriptionJob?.status === "FAILED";
  const detectedSpeakers = [
    ...new Set(
      transcript?.segments.flatMap((segment) =>
        segment.speakerKey === null ? [] : [segment.speakerKey],
      ) ?? [],
    ),
  ];

  useEffect(() => {
    if (!transcriptionActive) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [router, transcriptionActive]);

  useEffect(() => {
    const assignments: Record<string, string> = {};
    for (const segment of transcript?.segments ?? []) {
      if (
        segment.speakerKey &&
        (segment.speakerRole === "AGENT" || segment.speakerRole === "CUSTOMER")
      ) {
        assignments[segment.speakerKey] = segment.speakerRole;
      }
    }
    setSpeakerAssignments(assignments);
    setSpeakerEditorOpen(transcript?.status === "SPEAKERS_UNVERIFIED" && transcript.isDiarized);
  }, [transcript?.isDiarized, transcript?.segments, transcript?.status]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || !interaction.audioUrl) return;
    if (audio.paused) {
      void audio
        .play()
        .then(() => setPlaybackError(false))
        .catch(() => setPlaybackError(true));
    } else {
      audio.pause();
    }
  };

  const seek = (seconds: number, autoplay = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(seconds, 0), duration || interaction.durationSeconds);
    setCurrentTime(audio.currentTime);
    if (autoplay) {
      void audio
        .play()
        .then(() => setPlaybackError(false))
        .catch(() => setPlaybackError(true));
    }
  };

  const cyclePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.25 : playbackRate === 1.25 ? 1.5 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  return (
    <>
      <Card className={cn("border-primary/20 shadow-sm", className)}>
        <CardContent className={cn("flex flex-col gap-3", compact ? "p-3" : "p-4")}>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileAudio className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-semibold">{t("Call recording")}</p>
                  <Badge variant="outline">{t("Linked call")}</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {interaction.provider.replaceAll("_", " ")} · {interaction.providerInteractionId}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!interaction.audioUrl && interaction.recordingExpected ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  aria-label={t("Attach recording")}
                  disabled={recordingPending}
                  onClick={() =>
                    startRecordingTransition(async () => {
                      try {
                        const result = await attachCallRecording(interaction.id);
                        if (result.error) {
                          toast.error(t(result.error));
                          return;
                        }
                        toast.success(t("Recording attached"));
                        router.refresh();
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : t("Unable to attach recording"),
                        );
                      }
                    })
                  }
                >
                  <CloudDownload className={cn("size-4", recordingPending && "animate-pulse")} />
                  <span className="hidden sm:inline">
                    {recordingPending ? t("Loading recording") : t("Attach recording")}
                  </span>
                </Button>
              ) : null}
              {interaction.audioUrl ? (
                <a
                  href={`${interaction.audioUrl}?download=1`}
                  aria-label={t("Download recording")}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
                >
                  <Download className="size-4" />
                  <span className="hidden sm:inline">{t("Download")}</span>
                </a>
              ) : null}
              {interaction.audioUrl && !transcript ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  aria-label={t("Generate transcript")}
                  disabled={transcriptionPending || transcriptionActive}
                  onClick={() =>
                    startTranscriptionTransition(async () => {
                      try {
                        const result = await transcribeCallRecording(interaction.id);
                        if (result.error) {
                          toast.error(t(result.error));
                          return;
                        }
                        toast.success(
                          "alreadyCompleted" in result && result.alreadyCompleted
                            ? t("Transcript ready")
                            : t("Transcript queued"),
                        );
                        router.refresh();
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : t("Unable to generate transcript"),
                        );
                      }
                    })
                  }
                >
                  {transcriptionPending || transcriptionActive ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  <span className="hidden sm:inline">
                    {transcriptionPending
                      ? t("Queuing transcript")
                      : transcriptionJob?.status === "PENDING"
                        ? t("Transcript queued")
                        : transcriptionJob?.status === "PROCESSING"
                          ? t("Transcribing")
                          : transcriptionFailed
                            ? t("Retry transcript")
                            : t("Generate transcript")}
                  </span>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                aria-label={t("Open transcript")}
                disabled={!transcript}
                onClick={() => setTranscriptOpen(true)}
              >
                <ScrollText className="size-4" />
                <span className="hidden sm:inline">{t("Transcript")}</span>
              </Button>
            </div>
          </div>

          {interaction.audioUrl ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <audio
                ref={audioRef}
                preload="metadata"
                src={interaction.audioUrl}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setPlaybackError(true)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => {
                  if (Number.isFinite(event.currentTarget.duration)) {
                    setDuration(event.currentTarget.duration);
                  }
                }}
              >
                <track kind="captions" />
              </audio>
              <Button
                type="button"
                size="icon-sm"
                aria-label={playing ? t("Pause") : t("Play")}
                onClick={togglePlayback}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
              <span className="w-[76px] shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.1)}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => seek(Number(event.target.value))}
                aria-label={t("Call recording")}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1 px-2 tabular-nums"
                aria-label={t("Playback speed")}
                onClick={cyclePlaybackRate}
              >
                <Gauge className="size-3.5" />
                {playbackRate}×
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("This call has no recording attached yet.")}
            </p>
          )}

          {playbackError ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5" />
              {t("Recording unavailable")}
            </p>
          ) : null}

          {transcriptionFailed && !transcript ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5" />
              {t("Transcript processing failed. You can retry.")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Sheet open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <SheetContent className="w-[min(92vw,640px)] sm:max-w-xl">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{t("Transcript")}</SheetTitle>
            <SheetDescription>
              {transcript
                ? `${transcript.provider.replaceAll("_", " ")} · ${interaction.providerInteractionId}`
                : t("This call has no transcript yet.")}
            </SheetDescription>
          </SheetHeader>
          {transcript?.status === "SPEAKERS_UNVERIFIED" ? (
            <div className="mx-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
              <div className="flex items-center gap-2">
                <TriangleAlert className="size-4 shrink-0" />
                <span>
                  {transcript.isDiarized
                    ? t("Speaker labels are not verified")
                    : t("This transcript has no speaker separation yet.")}
                </span>
              </div>
              {!transcript.isDiarized ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 bg-background text-foreground"
                  disabled={transcriptionPending || transcriptionActive}
                  onClick={() =>
                    startTranscriptionTransition(async () => {
                      try {
                        const result = await transcribeCallRecording(interaction.id, {
                          requireDiarization: true,
                        });
                        if (result.error) {
                          toast.error(t(result.error));
                          return;
                        }
                        toast.success(t("Speaker identification queued"));
                        router.refresh();
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : t("Unable to identify speakers"),
                        );
                      }
                    })
                  }
                >
                  {transcriptionPending || transcriptionActive ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <UserRoundCheck className="size-4" />
                  )}
                  {t("Identify speakers")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {transcript?.isDiarized && transcript.status === "COMPLETED" && !speakerEditorOpen ? (
            <div className="mx-4 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => setSpeakerEditorOpen(true)}
              >
                <UserRoundCheck className="size-4" />
                {t("Edit speaker labels")}
              </Button>
            </div>
          ) : null}
          {transcript?.isDiarized && speakerEditorOpen && detectedSpeakers.length > 0 ? (
            <div className="mx-4 space-y-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <p className="text-sm font-medium">{t("Confirm speaker labels")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("Assign Agent or Customer to every detected speaker.")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {detectedSpeakers.map((speakerKey) => (
                  <div
                    key={speakerKey}
                    className="flex items-center justify-between gap-2 rounded-md border bg-background p-2"
                  >
                    <Badge variant="outline">
                      {t("Speaker {speaker}", { speaker: speakerKey })}
                    </Badge>
                    <Select
                      value={speakerAssignments[speakerKey] || undefined}
                      onValueChange={(value) =>
                        value &&
                        setSpeakerAssignments((current) => ({
                          ...current,
                          [speakerKey]: value,
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue placeholder={t("Select role")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AGENT">{t("Agent")}</SelectItem>
                        <SelectItem value="CUSTOMER">{t("Customer")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                {transcript.status === "COMPLETED" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={speakerPending}
                    onClick={() => setSpeakerEditorOpen(false)}
                  >
                    {t("Cancel")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={
                    speakerPending ||
                    detectedSpeakers.some(
                      (speakerKey) =>
                        speakerAssignments[speakerKey] !== "AGENT" &&
                        speakerAssignments[speakerKey] !== "CUSTOMER",
                    )
                  }
                  onClick={() =>
                    startSpeakerTransition(async () => {
                      try {
                        await confirmTranscriptSpeakerRoles({
                          interactionId: interaction.id,
                          transcriptId: transcript.id,
                          assignments: detectedSpeakers.map((speakerKey) => ({
                            speakerKey,
                            role: speakerAssignments[speakerKey],
                          })),
                        });
                        toast.success(t("Speaker labels confirmed"));
                        setSpeakerEditorOpen(false);
                        router.refresh();
                      } catch (error) {
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : t("Unable to confirm speaker labels"),
                        );
                      }
                    })
                  }
                >
                  {speakerPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <UserRoundCheck className="size-4" />
                  )}
                  {t("Save speaker labels")}
                </Button>
              </div>
            </div>
          ) : null}
          <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
            {transcript && transcript.segments.length > 0 ? (
              <div className="space-y-1 py-1">
                {transcript.segments.map((segment) => {
                  const active =
                    currentTime * 1000 >= segment.startMs && currentTime * 1000 < segment.endMs;
                  return (
                    <button
                      key={segment.id}
                      type="button"
                      onClick={() => seek(segment.startMs / 1000, true)}
                      className={cn(
                        "grid w-full grid-cols-[52px_88px_1fr] gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                        active && "bg-primary/10",
                      )}
                    >
                      <span className="pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {formatDuration(segment.startMs / 1000)}
                      </span>
                      <Badge
                        variant={segment.speakerRole === "AGENT" ? "default" : "secondary"}
                        className="max-w-[86px] truncate"
                      >
                        {speakerLabel(segment.speakerRole, segment.speakerKey, t)}
                      </Badge>
                      <span className="whitespace-pre-wrap text-sm leading-5">{segment.text}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("This call has no transcript yet.")}
              </p>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
