import { CalendarX } from "lucide-react";
import type { BookingConflict } from "@shared/contracts/work-order-booking";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeBookingConflict } from "@/lib/booking-conflict";

/** Liste les chevauchements refuses par le serveur (409), un par ligne. */
export function BookingConflictAlert({ conflicts }: { conflicts: BookingConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <Alert variant="destructive" role="alert">
      <CalendarX className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Affectation impossible</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {conflicts.map((c, i) => (
            <li key={`${c.kind}-${c.workOrderId}-${i}`}>{describeBookingConflict(c)}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
