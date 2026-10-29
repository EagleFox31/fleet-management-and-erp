import { useRef, useState } from "react";
import { singleFlight, type MutateWithSettled } from "@/lib/single-flight";

/**
 * Envoi d'une mutation protégé contre le double clic (voir `lib/single-flight`).
 *
 * @example
 * const submitPayment = useSingleFlightMutate(paymentMutation.mutate);
 * <Button onClick={() => submitPayment()} disabled={paymentMutation.isPending} />
 */
export function useSingleFlightMutate<TVariables = void>(
  mutate: MutateWithSettled<TVariables>,
): (variables: TVariables) => boolean {
  const latestMutate = useRef(mutate);
  latestMutate.current = mutate;
  const [submit] = useState(() =>
    singleFlight<TVariables>((variables, options) => latestMutate.current(variables, options)),
  );
  return submit;
}
