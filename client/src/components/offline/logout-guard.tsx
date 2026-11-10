import { useCallback, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { pendingSendCount } from "@/lib/offline-queue";
import { discardSendsLabel, logoutBlockedMessage } from "@/lib/offline-queue-core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Déconnexion gardée : s'il reste des envois hors ligne non partis, la déconnexion est
 * bloquée et l'utilisateur choisit explicitement de les supprimer (S1 : la déconnexion
 * purge la file, jamais en silence). Sans drapeau `offline-writes`, le compte est à 0 et
 * la déconnexion part tout de suite, comme avant.
 */
export function useGuardedLogout(onLoggedOut?: () => void): { requestLogout: () => Promise<void>; guardDialog: ReactNode } {
  const { logout } = useAuth();
  const [blockedCount, setBlockedCount] = useState(0);

  const requestLogout = useCallback(async () => {
    const count = await pendingSendCount();
    if (count > 0) {
      setBlockedCount(count);
      return;
    }
    await logout();
    onLoggedOut?.();
  }, [logout, onLoggedOut]);

  const guardDialog = (
    <AlertDialog open={blockedCount > 0} onOpenChange={(open) => !open && setBlockedCount(0)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Envois en attente</AlertDialogTitle>
          <AlertDialogDescription>{logoutBlockedMessage(blockedCount)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Rester connecté</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setBlockedCount(0);
              void logout().then(() => onLoggedOut?.());
            }}
          >
            {discardSendsLabel(blockedCount)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { requestLogout, guardDialog };
}
