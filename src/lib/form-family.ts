export const FORM_FAMILY_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  PENDING_CHANGES: "PENDING_CHANGES",
} as const;

export type FormFamilyStatus = (typeof FORM_FAMILY_STATUS)[keyof typeof FORM_FAMILY_STATUS];

type FormFamilyTimestamp = Date | string | number;

export type FormFamilyMember = {
  id: string;
  campaignId: string;
  parentFormId: string | null;
  status: string;
  createdAt: FormFamilyTimestamp;
  updatedAt: FormFamilyTimestamp;
  version?: unknown;
};

type PresentationMetadata = {
  familyKey: string;
  familyId: string;
  status: FormFamilyStatus;
  editableFormId: string;
  evaluationFormId: string | null;
};

type PresentationReservedKey = "version" | "parentFormId" | "status" | keyof PresentationMetadata;

export type FormFamilyPresentation<T extends FormFamilyMember> = Omit<T, PresentationReservedKey> &
  PresentationMetadata;

type FormFamily<T extends FormFamilyMember> = {
  familyKey: string;
  familyId: string;
  draft: T | null;
  published: T | null;
};

export function getFormFamilyKey(
  form: Pick<FormFamilyMember, "campaignId" | "id" | "parentFormId">,
) {
  return `${form.campaignId}:${form.parentFormId ?? form.id}`;
}

export function collapseFormFamilies<T extends FormFamilyMember>(
  forms: readonly T[],
): FormFamilyPresentation<T>[] {
  const families = new Map<string, FormFamily<T>>();

  for (const form of forms) {
    if (form.status !== FORM_FAMILY_STATUS.DRAFT && form.status !== FORM_FAMILY_STATUS.PUBLISHED) {
      continue;
    }

    const familyId = form.parentFormId ?? form.id;
    const familyKey = getFormFamilyKey(form);
    const family = families.get(familyKey) ?? {
      familyKey,
      familyId,
      draft: null,
      published: null,
    };

    if (form.status === FORM_FAMILY_STATUS.DRAFT) {
      family.draft = pickMostRecent(family.draft, form);
    } else {
      family.published = pickMostRecent(family.published, form);
    }

    families.set(familyKey, family);
  }

  return Array.from(families.values(), toPresentation);
}

function toPresentation<T extends FormFamilyMember>(
  family: FormFamily<T>,
): FormFamilyPresentation<T> {
  const visibleForm = family.draft ?? family.published;
  if (!visibleForm) {
    throw new Error("A form family must contain a draft or published form");
  }

  const {
    parentFormId: _parentFormId,
    status: _memberStatus,
    version: _version,
    ...visibleData
  } = visibleForm;

  return {
    ...visibleData,
    familyKey: family.familyKey,
    familyId: family.familyId,
    status: family.draft
      ? family.published
        ? FORM_FAMILY_STATUS.PENDING_CHANGES
        : FORM_FAMILY_STATUS.DRAFT
      : FORM_FAMILY_STATUS.PUBLISHED,
    editableFormId: visibleForm.id,
    evaluationFormId: family.published?.id ?? null,
  } as FormFamilyPresentation<T>;
}

function pickMostRecent<T extends FormFamilyMember>(current: T | null, candidate: T): T {
  if (!current) return candidate;

  const updatedDifference = toTimestamp(candidate.updatedAt) - toTimestamp(current.updatedAt);
  if (updatedDifference !== 0) return updatedDifference > 0 ? candidate : current;

  const createdDifference = toTimestamp(candidate.createdAt) - toTimestamp(current.createdAt);
  if (createdDifference !== 0) return createdDifference > 0 ? candidate : current;

  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

function toTimestamp(value: FormFamilyTimestamp) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}
