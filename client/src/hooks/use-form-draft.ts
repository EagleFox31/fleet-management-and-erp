import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import {
  formatDraftSavedTime,
  type FormDraftPayload,
  type FormDraftStorage,
} from "@/lib/form-draft-storage";

export type UseFormDraftOptions<TData extends FieldValues, TMeta = undefined> = {
  form: UseFormReturn<TData>;
  storage: FormDraftStorage<TData, TMeta>;
  userId?: number | string;
  debounceMs?: number;
  enabled?: boolean;
  /** Ignore restore/persist when the form is still blank. */
  isEmpty?: (data: TData) => boolean;
  /** Extra state saved with the draft (wizard step, tab index…). */
  getMeta?: () => TMeta;
  /** Rehydrate extra state after restore. */
  applyMeta?: (meta: TMeta) => void;
  restoreTitle?: string;
  restoreDescription?: (draft: FormDraftPayload<TData, TMeta>) => string;
};

export function useFormDraft<TData extends FieldValues, TMeta = undefined>({
  form,
  storage,
  userId,
  debounceMs = 600,
  enabled = true,
  isEmpty,
  getMeta,
  applyMeta,
  restoreTitle = "Brouillon restauré",
  restoreDescription,
}: UseFormDraftOptions<TData, TMeta>) {
  const { toast } = useToast();
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const restoredRef = useRef(false);

  const persistDraft = useCallback(
    (data?: TData, meta?: TMeta) => {
      const values = data ?? form.getValues();
      if (isEmpty?.(values)) {
        return;
      }

      const savedAt = new Date().toISOString();
      const payload = {
        data: values,
        savedAt,
        ...(meta !== undefined
          ? { meta }
          : getMeta
            ? { meta: getMeta() }
            : {}),
      } as FormDraftPayload<TData, TMeta>;

      storage.save(userId, payload);
      setDraftSavedAt(savedAt);
    },
    [form, getMeta, isEmpty, storage, userId],
  );

  const clearDraft = useCallback(() => {
    storage.clear(userId);
    setDraftSavedAt(null);
  }, [storage, userId]);

  const discardDraft = useCallback(
    (defaultValues: TData, onAfterDiscard?: () => void) => {
      clearDraft();
      form.reset(defaultValues);
      onAfterDiscard?.();
      toast({ title: "Brouillon supprimé" });
    },
    [clearDraft, form, toast],
  );

  useEffect(() => {
    if (!enabled || restoredRef.current) {
      return;
    }
    restoredRef.current = true;

    const draft = storage.load(userId);
    if (!draft) {
      return;
    }

    if (isEmpty?.(draft.data)) {
      storage.clear(userId);
      return;
    }

    form.reset(draft.data);
    if (draft.meta != null && applyMeta) {
      applyMeta(draft.meta);
    }
    setDraftSavedAt(draft.savedAt);

    toast({
      title: restoreTitle,
      description:
        restoreDescription?.(draft) ??
        `Reprise de la saisie (sauvegarde ${formatDraftSavedTime(draft.savedAt)}).`,
    });
  }, [
    applyMeta,
    enabled,
    form,
    isEmpty,
    restoreDescription,
    restoreTitle,
    storage,
    toast,
    userId,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: number | undefined;
    const subscription = form.watch((values) => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        persistDraft(values as TData);
      }, debounceMs);
    });

    return () => {
      subscription.unsubscribe();
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [debounceMs, enabled, form, persistDraft]);

  return {
    draftSavedAt,
    hasDraft: draftSavedAt != null,
    persistDraft,
    clearDraft,
    discardDraft,
  };
}
