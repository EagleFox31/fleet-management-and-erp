import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { userMessageOf } from "@/lib/api-error";
import { cn } from "@/lib/utils";

interface InlineQueryErrorProps {
  error: unknown;
  /** Message affiché si l'erreur n'en porte pas de lisible. */
  fallback: string;
  onRetry?: () => void;
  /** Un nouvel essai est en cours : le bouton « Réessayer » est désactivé. */
  isRetrying?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * Encart compact pour une tuile, un onglet ou un champ dont la requête a échoué sans données :
 * message lisible (`userMessageOf`, avec la référence d'une 5xx) et « Réessayer ».
 * Remplace la valeur, jamais « Aucun… » ni un 0.
 */
export function InlineQueryError({
  error,
  fallback,
  onRetry,
  isRetrying = false,
  className,
  "data-testid": testId,
}: InlineQueryErrorProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text",
        className,
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{userMessageOf(error, fallback)}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          )}
          Réessayer
        </Button>
      ) : null}
    </div>
  );
}
