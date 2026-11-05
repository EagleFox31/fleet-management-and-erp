import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { notifyComingSoon } from "@/lib/coming-soon"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Action présente dans l'interface mais pas encore développée.
   * Passer le nom métier de la fonctionnalité: le clic affiche un message
   * uniforme au lieu de ne rien faire.
   *
   *   <Button comingSoon="La commande de pneus">Commander</Button>
   *
   * Ne PAS utiliser pour une action refusée par les droits: dans ce cas il faut
   * masquer le bouton (voir AGENTS.md).
   */
  comingSoon?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, comingSoon, onClick, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (comingSoon) {
        event.preventDefault()
        notifyComingSoon(comingSoon)
        return
      }

      if (onClick) {
        onClick(event)
        return
      }

      // Filet de développement: un bouton sans gestionnaire, hors soumission de
      // formulaire et hors lien, ne fait rien au clic. On le signale au
      // développeur — jamais à l'utilisateur — pour qu'il ajoute `onClick` ou
      // `comingSoon`. Vérification au clic (et non au rendu) pour pouvoir
      // remonter le DOM: un bouton enveloppé dans un <a> est légitime.
      if (import.meta.env.DEV && !asChild && type !== "submit") {
        const cible = event.currentTarget as HTMLElement | null
        const dansUnLien = cible?.closest("a") !== null
        if (!dansUnLien) {
          console.warn(
            "[Button] Clic sans effet: ce bouton n'a ni `onClick`, ni `type=\"submit\"`, " +
              "ni lien parent. Ajouter un gestionnaire, ou `comingSoon=\"…\"` si la " +
              "fonctionnalité n'est pas encore développée.",
            cible,
          )
        }
      }
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={type}
        onClick={handleClick}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
