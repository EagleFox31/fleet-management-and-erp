/**
 * Garde contre la double soumission d'une mutation.
 *
 * `disabled={mutation.isPending}` ne suffit pas : `isPending` ne passe à `true`
 * qu'au rendu suivant, et le second clic d'un double clic arrive avant. Mesuré
 * en e2e sur l'encaissement client : deux paiements enregistrés à 65 ms d'écart.
 * Ici le verrou est pris de façon synchrone, dans le gestionnaire de clic même.
 *
 * Le verrou est rendu au `onSettled` de la mutation (succès ou erreur). Garder
 * le `disabled={isPending}` pour l'affichage : la garde n'en change pas le rendu.
 */
export type MutateWithSettled<TVariables> = (
  variables: TVariables,
  options: { onSettled: () => void },
) => void;

/** Retourne une fonction d'envoi qui renvoie `false` quand l'appel est ignoré. */
export function singleFlight<TVariables>(
  mutate: MutateWithSettled<TVariables>,
): (variables: TVariables) => boolean {
  let inFlight = false;
  const release = () => {
    inFlight = false;
  };

  return (variables) => {
    if (inFlight) return false;
    inFlight = true;
    try {
      mutate(variables, { onSettled: release });
    } catch (error) {
      release();
      throw error;
    }
    return true;
  };
}
