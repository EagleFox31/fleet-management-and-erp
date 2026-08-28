import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Truck, MessageCircle, X } from "lucide-react";

interface FleetMascotProps {
  message: string;
  isVisible: boolean;
  position?: "bottom-right" | "center" | "top-right";
  animation?: "bounce" | "fade" | "slide";
  showBubble?: boolean;
  onCloseBubble?: () => void;
  onClick?: () => void;
}

export function FleetMascot({ 
  message, 
  isVisible, 
  position = "bottom-right",
  animation = "bounce",
  showBubble = true,
  onCloseBubble,
  onClick 
}: FleetMascotProps) {
  const getPositionClasses = () => {
    switch (position) {
      case "center":
        return "fixed inset-0 flex items-center justify-center z-50";
      case "top-right":
        return "fixed top-4 right-4 z-50";
      case "bottom-right":
      default:
        return "fixed bottom-4 right-4 z-50";
    }
  };

  const getAnimationVariants = () => {
    switch (animation) {
      case "fade":
        return {
          initial: { opacity: 0, scale: 0.8 },
          animate: { opacity: 1, scale: 1 },
          exit: { opacity: 0, scale: 0.8 },
        };
      case "slide":
        return {
          initial: { x: 100, opacity: 0 },
          animate: { x: 0, opacity: 1 },
          exit: { x: 100, opacity: 0 },
        };
      case "bounce":
      default:
        return {
          initial: { y: 100, opacity: 0, scale: 0.8 },
          animate: { 
            y: 0, 
            opacity: 1, 
            scale: 1,
            transition: {
              type: "spring",
              stiffness: 300,
              damping: 20,
            }
          },
          exit: { y: 100, opacity: 0, scale: 0.8 },
        };
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <div className={getPositionClasses()}>
          <motion.div
            className="flex flex-col items-end space-y-2"
            {...getAnimationVariants()}
          >
            {/* Message Bubble */}
            {showBubble && message && (
              <motion.div
                className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 max-w-xs border border-blue-100 dark:border-blue-800"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                {onCloseBubble && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseBubble();
                    }}
                    className="absolute top-2 right-2 rounded-sm p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label="Fermer le message"
                    title="Fermer le message"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                  {message}
                </div>
                {/* Speech bubble tail */}
                <div className="absolute bottom-0 right-6 transform translate-y-1/2 rotate-45 w-2 h-2 bg-white dark:bg-gray-800 border-r border-b border-blue-100 dark:border-blue-800"></div>
              </motion.div>
            )}

            {/* Mascot */}
            <motion.div
              className="relative cursor-pointer"
              onClick={onClick}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              animate={{
                y: [0, -8, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              {/* Mascot Container */}
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full shadow-lg flex items-center justify-center">
                <Truck className="w-8 h-8 text-white" />
              </div>

              {/* Notification Indicator */}
              <motion.div
                className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white flex items-center justify-center"
                animate={{
                  scale: [1, 1.2, 1],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <MessageCircle className="w-2 h-2 text-white" />
              </motion.div>

              {/* Pulsing Ring Effect */}
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-blue-400"
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.7, 0, 0.7],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Mascot avec différentes expressions
export function FleetMascotVariants({ 
  variant = "default",
  size = "md",
  className = "",
}: {
  variant?: "default" | "happy" | "thinking" | "celebrating" | "warning";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const getSizeClasses = () => {
    switch (size) {
      case "sm":
        return "w-12 h-12";
      case "lg":
        return "w-20 h-20";
      case "md":
      default:
        return "w-16 h-16";
    }
  };

  const getVariantColor = () => {
    switch (variant) {
      case "happy":
        return "from-green-500 to-green-600";
      case "thinking":
        return "from-purple-500 to-purple-600";
      case "celebrating":
        return "from-yellow-500 to-yellow-600";
      case "warning":
        return "from-red-500 to-red-600";
      case "default":
      default:
        return "from-blue-500 to-blue-600";
    }
  };

  const getVariantAnimation = () => {
    switch (variant) {
      case "celebrating":
        return {
          rotate: [0, 10, -10, 0],
          scale: [1, 1.1, 1],
        };
      case "thinking":
        return {
          y: [0, -5, 0],
        };
      case "warning":
        return {
          x: [0, -3, 3, 0],
        };
      default:
        return {
          y: [0, -5, 0],
        };
    }
  };

  return (
    <motion.div
      className={`${getSizeClasses()} bg-gradient-to-br ${getVariantColor()} rounded-full shadow-lg flex items-center justify-center ${className}`}
      animate={getVariantAnimation()}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <Truck className={`${size === "sm" ? "w-6 h-6" : size === "lg" ? "w-10 h-10" : "w-8 h-8"} text-white`} />
    </motion.div>
  );
}
