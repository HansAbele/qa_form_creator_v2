-- Add the managed provider used for mono call diarization.
ALTER TYPE "TranscriptProvider" ADD VALUE 'DEEPGRAM';

-- Preserve whether a queued retry must return speaker labels instead of
-- accepting a plain transcription provider as a successful fallback.
ALTER TABLE "TranscriptionJob"
ADD COLUMN "requireDiarization" BOOLEAN NOT NULL DEFAULT false;
