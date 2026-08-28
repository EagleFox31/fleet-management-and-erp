export type FormDraftPayload<TData, TMeta = undefined> = {
  version: number;
  data: TData;
  savedAt: string;
} & (TMeta extends undefined ? { meta?: never } : { meta: TMeta });

export type FormDraftSaveInput<TData, TMeta = undefined> = {
  data: TData;
  savedAt: string;
} & (TMeta extends undefined ? { meta?: never } : { meta: TMeta });

export type FormDraftStorage<TData, TMeta = undefined> = {
  load: (userId?: number | string) => FormDraftPayload<TData, TMeta> | null;
  save: (
    userId: number | string | undefined,
    draft: FormDraftSaveInput<TData, TMeta>,
  ) => void;
  clear: (userId?: number | string) => void;
};

function draftKey(formId: string, version: number, userId?: number | string): string {
  return `fleetos-${formId}-v${version}-${userId ?? "anonymous"}`;
}

export function createFormDraftStorage<TData, TMeta = undefined>(options: {
  formId: string;
  version: number;
}): FormDraftStorage<TData, TMeta> {
  const { formId, version } = options;

  return {
    load(userId) {
      if (typeof window === "undefined") {
        return null;
      }

      try {
        const raw = window.localStorage.getItem(draftKey(formId, version, userId));
        if (!raw) {
          return null;
        }

        const parsed = JSON.parse(raw) as FormDraftPayload<TData, TMeta>;
        if (parsed.version !== version || parsed.data == null) {
          return null;
        }

        return parsed;
      } catch {
        return null;
      }
    },

    save(userId, draft) {
      if (typeof window === "undefined") {
        return;
      }

      const payload: FormDraftPayload<TData, TMeta> = {
        version,
        ...draft,
      } as FormDraftPayload<TData, TMeta>;

      window.localStorage.setItem(draftKey(formId, version, userId), JSON.stringify(payload));
    },

    clear(userId) {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.removeItem(draftKey(formId, version, userId));
    },
  };
}

export function formatDraftSavedTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
