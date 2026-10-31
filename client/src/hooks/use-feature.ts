import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FEATURE_FLAGS,
  FEATURE_FLAGS_PATH,
  featureFlagsResponseSchema,
  type FeatureFlagsResponse,
  type FeatureKey,
} from "@shared/feature-flags";

/** Valeurs avant la première réponse du serveur : les défauts du catalogue. */
export function defaultFeatureFlags(): FeatureFlagsResponse {
  const flags = {} as FeatureFlagsResponse;
  for (const key of Object.keys(FEATURE_FLAGS) as FeatureKey[]) {
    flags[key] = FEATURE_FLAGS[key].defaultEnabled;
  }
  return flags;
}

/**
 * Fusionne la réponse du serveur sur les défauts. Une réponse invalide ou
 * partielle ne coupe ni n'allume rien au-delà de ce qu'elle déclare : les clés
 * absentes gardent leur défaut.
 */
export function resolveClientFeatureFlags(data: unknown): FeatureFlagsResponse {
  const parsed = featureFlagsResponseSchema.safeParse(data);
  return { ...defaultFeatureFlags(), ...(parsed.success ? parsed.data : {}) };
}

/**
 * Drapeaux effectifs. Le rendu n'attend jamais le réseau : tant que la requête
 * n'a pas répondu (ou échoue), ce sont les défauts. Le drapeau client est
 * cosmétique ; la garde réelle est `requireFeature` côté serveur (404).
 */
export function useFeatureFlags(): FeatureFlagsResponse {
  const { data } = useQuery<unknown>({
    queryKey: [FEATURE_FLAGS_PATH],
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  return useMemo(() => resolveClientFeatureFlags(data), [data]);
}

export function useFeature(key: FeatureKey): boolean {
  return useFeatureFlags()[key];
}
