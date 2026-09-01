import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { App as CapacitorApp } from "@capacitor/app";

/**
 * Détecte si l'application s'exécute dans un wrapper natif (Android APK / iOS)
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Initialise et demande les permissions de notifications natives sur Android (Android 13+)
 */
export async function initNativeNotifications(): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted") {
      const request = await LocalNotifications.requestPermissions();
      return request.display === "granted";
    }
    return true;
  } catch (err) {
    console.warn("Permission de notifications natives non disponible:", err);
    return false;
  }
}

/**
 * Déclenche une notification locale native Android dans le volet supérieur
 */
export async function triggerNativeNotification({
  title,
  body,
  id,
  extra,
}: {
  title: string;
  body: string;
  id?: number;
  extra?: Record<string, unknown>;
}): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    const hasPermission = await initNativeNotifications();
    if (!hasPermission) return;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: id ?? Math.floor(Math.random() * 100_000),
          title,
          body,
          extra: extra || (id ? { route: `/maintenance/work-orders/${id}` } : undefined),
          schedule: { at: new Date(Date.now() + 100) },
          sound: "beep.wav",
        },
      ],
    });

    // Retour haptique de notification
    await triggerNativeHaptic("notification");
  } catch (err) {
    console.warn("Échec d'envoi de la notification native:", err);
  }
}

/**
 * Configure la navigation automatique (Deep-linking) lors du tap sur une notification
 */
export function setupNotificationClickListener(navigate: (path: string) => void): () => void {
  if (!isNativePlatform()) return () => {};

  let isMounted = true;
  const listenerPromise = LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (action) => {
      if (!isMounted) return;
      const extra = action.notification.extra;
      const targetRoute =
        extra?.route ||
        (action.notification.id ? `/maintenance/work-orders/${action.notification.id}` : null);

      if (targetRoute && typeof targetRoute === "string") {
        navigate(targetRoute);
      }
    },
  );

  return () => {
    isMounted = false;
    listenerPromise.then((handle) => handle.remove()).catch(() => {});
  };
}

/**
 * Gère le bouton retour physique / gestuel d'Android pour naviguer en arrière sans fermer l'app
 */
export function setupHardwareBackButton(
  navigate: (path: string) => void,
  currentPath: string,
): () => void {
  if (!isNativePlatform()) return () => {};

  let isMounted = true;
  let lastBackPress = 0;

  const listenerPromise = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    if (!isMounted) return;

    // Si on est sur une page principale, double-tap pour quitter
    const isRootPage =
      currentPath === "/" ||
      currentPath === "/dashboard" ||
      currentPath === "/technician/dashboard" ||
      currentPath === "/login";

    if (isRootPage) {
      const now = Date.now();
      if (now - lastBackPress < 2000) {
        CapacitorApp.exitApp();
      } else {
        lastBackPress = now;
        triggerNativeHaptic("selection");
      }
    } else if (canGoBack && window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/dashboard");
    }
  });

  return () => {
    isMounted = false;
    listenerPromise.then((handle) => handle.remove()).catch(() => {});
  };
}

/**
 * Déclenche une vibration / retour haptique sur le téléphone
 */
export async function triggerNativeHaptic(
  type: "impact" | "notification" | "selection" = "impact",
): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    if (type === "notification") {
      await Haptics.notification({ type: NotificationType.Success });
    } else if (type === "selection") {
      await Haptics.selectionChanged();
    } else {
      await Haptics.impact({ style: ImpactStyle.Medium });
    }
  } catch {
    // Silencieux sur les plateformes sans moteur haptique
  }
}

/**
 * Capture une photo avec l'appareil photo du téléphone ou sélectionne depuis la galerie
 */
export async function capturePhotoWithCamera(): Promise<string | null> {
  if (!isNativePlatform()) return null;

  try {
    const image = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      promptLabelHeader: "Pièce ou Véhicule",
      promptLabelPhoto: "Choisir depuis la galerie",
      promptLabelPicture: "Prendre une photo",
    });

    return image.webPath ?? null;
  } catch (err) {
    console.warn("Prise de photo annulée ou erreur:", err);
    return null;
  }
}
