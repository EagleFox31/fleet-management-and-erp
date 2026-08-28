import React from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Wifi, Clock, Database, Key, Wrench } from "lucide-react";

const playfulMessages = {
  network: [
    "🌐 Internet fait la sieste !",
    "📡 Signal en vacances...",
    "🔌 Le wifi boude un peu",
    "🛜 Connexion en mode tortue"
  ],
  auth: [
    "🔐 Sesame, ouvre-toi !",
    "🎫 Votre ticket a expiré",
    "👤 Qui va là ?",
    "🚪 Accès VIP requis"
  ],
  validation: [
    "📝 Il manque des infos !",
    "⚠️ Quelque chose cloche...",
    "🔍 Vérifiez vos données",
    "📋 Formulaire incomplet"
  ],
  server: [
    "🔧 Nos serveurs font une pause",
    "⚙️ Machine en maintenance",
    "🤖 Robot en panne",
    "🏗️ Travaux en cours"
  ],
  timeout: [
    "⏰ Plus lent qu'un escargot !",
    "🐌 En mode économie d'énergie",
    "⌛ Le temps s'est arrêté",
    "🕰️ Patience, ça arrive..."
  ],
  general: [
    "🤔 Quelque chose ne va pas",
    "🐛 Un petit bug s'est glissé",
    "❓ Situation inattendue",
    "🔄 Essayons encore..."
  ]
};

interface PlayfulErrorMessageProps {
  type: keyof typeof playfulMessages;
  animate?: boolean;
}

export function PlayfulErrorMessage({ type, animate = true }: PlayfulErrorMessageProps) {
  const messages = playfulMessages[type];
  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  
  const iconMap = {
    network: Wifi,
    auth: Key,
    validation: AlertTriangle,
    server: Database,
    timeout: Clock,
    general: Wrench
  };
  
  const Icon = iconMap[type];
  
  if (!animate) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-sm">{randomMessage}</span>
      </div>
    );
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-2 text-muted-foreground"
    >
      <motion.div
        animate={{ 
          rotate: [0, -10, 10, -5, 5, 0],
          scale: [1, 1.1, 1]
        }}
        transition={{ 
          duration: 0.8,
          repeat: 2,
          repeatType: "reverse"
        }}
      >
        <Icon className="h-4 w-4" />
      </motion.div>
      <motion.span
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
        className="text-sm"
      >
        {randomMessage}
      </motion.span>
    </motion.div>
  );
}

export function getPlayfulErrorMessage(type: keyof typeof playfulMessages): string {
  const messages = playfulMessages[type];
  return messages[Math.floor(Math.random() * messages.length)];
}