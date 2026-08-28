import { Cloud, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDraftSavedTime } from "@/lib/form-draft-storage";

type FormDraftBadgeProps = {
  savedAt: string | null;
  className?: string;
};

export function FormDraftBadge({ savedAt, className }: FormDraftBadgeProps) {
  if (!savedAt) {
    return null;
  }

  return (
    <Badge variant="secondary" className={`gap-1 rounded-full font-normal ${className ?? ""}`}>
      <Cloud className="h-3 w-3" />
      Brouillon {formatDraftSavedTime(savedAt)}
    </Badge>
  );
}

type FormDraftDiscardButtonProps = {
  savedAt: string | null;
  onDiscard: () => void;
  className?: string;
};

export function FormDraftDiscardButton({
  savedAt,
  onDiscard,
  className,
}: FormDraftDiscardButtonProps) {
  if (!savedAt) {
    return null;
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={onDiscard} className={className}>
      <Trash2 className="mr-1 h-4 w-4" />
      Effacer brouillon
    </Button>
  );
}
