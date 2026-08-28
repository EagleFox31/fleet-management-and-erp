import React, { createContext, useContext, useState, ReactNode } from 'react';

interface VehicleInfo {
  id: number;
  registrationNumber: string;
  brand?: string;
  model?: string;
}

interface VehicleContextType {
  selectedVehicle: VehicleInfo | null;
  setSelectedVehicle: (vehicle: VehicleInfo | null) => void;
  clearSelectedVehicle: () => void;
}

const VehicleContext = createContext<VehicleContextType | undefined>(undefined);

export function VehicleProvider({ children }: { children: ReactNode }) {
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleInfo | null>(null);

  const clearSelectedVehicle = () => {
    setSelectedVehicle(null);
  };

  return (
    <VehicleContext.Provider
      value={{
        selectedVehicle,
        setSelectedVehicle,
        clearSelectedVehicle,
      }}
    >
      {children}
    </VehicleContext.Provider>
  );
}

export function useVehicle() {
  const context = useContext(VehicleContext);
  if (context === undefined) {
    throw new Error('useVehicle must be used within a VehicleProvider');
  }
  return context;
}