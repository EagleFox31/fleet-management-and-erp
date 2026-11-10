import { useRef } from "react";
import { Camera, Download, ExternalLink, FileText, Loader2, Upload } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { missionPodFilePath } from "@shared/contracts/mission-pod";
import { useMissionPodFiles, useMissionPodUpload, type PodFileRow } from "@/hooks/use-mission-pod";
import { POD_ACCEPT, canDepositPod } from "@/lib/mission-pod";

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "Image JPEG",
  "image/png": "Image PNG",
  "image/webp": "Image WebP",
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd MMM yyyy HH:mm", { locale: fr });
}

function PodRow({ missionId, file }: { missionId: number; file: PodFileRow }) {
  const url = missionPodFilePath(missionId, file.id);
  const isImage = file.mime.startsWith("image/");
  return (
    <li className="flex items-center gap-3 py-2" data-testid={`pod-file-${file.id}`}>
      {isImage ? (
        <img src={url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{file.originalName ?? "Fichier sans nom"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {MIME_LABELS[file.mime] ?? file.mime} · {formatSize(file.sizeBytes)} · {formatWhen(file.uploadedAt)}
          {file.uploadedByName ? ` · ${file.uploadedByName}` : ""}
        </p>
      </div>
      {isImage && (
      <Button asChild variant="ghost" size="sm" className="h-8 px-2">
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${file.originalName ?? "le fichier"}`}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </Button>
      )}
      <Button asChild variant="ghost" size="sm" className="h-8 px-2">
        <a href={url} download={file.originalName ?? undefined} aria-label={`Télécharger ${file.originalName ?? "le fichier"}`}>
          <Download className="h-4 w-4" aria-hidden="true" />
        </a>
      </Button>
    </li>
  );
}

/** Bouton de dépôt : visible seulement pour un rôle autorisé et une mission où le serveur accepte le dépôt. */
export function PodDepositButton({
  missionId,
  status,
  role,
  className = "h-8 gap-1.5 px-3 text-xs",
  testId = "button-pod-deposit",
  tile = false,
  capture = false,
}: {
  missionId: number;
  status: string;
  role: string | null | undefined;
  className?: string;
  testId?: string;
  /** Tuile de l'écran chauffeur (PWA) au lieu d'un bouton d'action. */
  tile?: boolean;
  /** Ouvre l'appareil photo arrière sur mobile. */
  capture?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useMissionPodUpload(() => {
    if (input.current) input.current.value = "";
  });
  if (!canDepositPod(role, status)) return null;
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={POD_ACCEPT}
        {...(capture ? { capture: "environment" as const } : {})}
        className="sr-only"
        aria-label="Choisir les fichiers du POD"
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length > 0) upload.submit({ missionId, files: picked });
        }}
      />
      {tile ? (
        <button
          type="button"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
          data-testid={testId}
          className={className}
        >
          {upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Camera className="h-5 w-5 text-primary-text" aria-hidden="true" />}
          {upload.isPending ? "Envoi..." : "Déposer le POD"}
        </button>
      ) : (
      <Button type="button" size="sm" className={className} disabled={upload.isPending} onClick={() => input.current?.click()} data-testid={testId}>
        {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
        {upload.isPending ? "Envoi..." : "Déposer le POD"}
      </Button>
      )}
    </>
  );
}

/** Preuves de livraison d'une mission : liste, ouverture, téléchargement et dépôt (rôles et statuts autorisés). */
export function MissionPodPanel({ missionId, status, role }: { missionId: number; status: string; role: string | null | undefined }) {
  const { files, failed, error, isLoading, isFetching, refetch } = useMissionPodFiles(missionId);
  const canDeposit = canDepositPod(role, status);

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="mission-pod-title" data-testid="mission-pod-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="mission-pod-title" className="text-sm font-semibold text-foreground">Preuve de livraison (POD)</h3>
        <PodDepositButton missionId={missionId} status={status} role={role} testId="button-pod-deposit-panel" />
      </div>
      {failed ? (
        <InlineQueryError error={error} fallback="Impossible de lire les preuves de livraison." onRetry={() => void refetch()} isRetrying={isFetching} data-testid="pod-read-error" />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement des preuves de livraison...</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pod-empty">
          {canDeposit ? "Aucun POD déposé. PDF, JPEG, PNG ou WebP, 10 Mo au plus par fichier." : "Aucun POD déposé."}
        </p>
      ) : (
        <ul className="divide-y divide-border" data-testid="pod-list">
          {files.map((file) => <PodRow key={file.id} missionId={missionId} file={file} />)}
        </ul>
      )}
    </section>
  );
}
