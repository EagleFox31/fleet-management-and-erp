import React, { ReactNode } from "react";

interface PrintLayoutProps {
  title: string;
  children: ReactNode;
  showFooter?: boolean;
}

export function PrintLayout({ title, children, showFooter = true }: PrintLayoutProps) {
  return (
    <div className="print-container">
      {/* Style spécifique pour l'impression */}
      <style>
        {`
          @media print {
            body * {
              visibility: hidden;
            }
            .print-container, .print-container * {
              visibility: visible;
            }
            .print-container {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .no-print {
              display: none !important;
            }
          }
        `}
      </style>

      {/* En-tête d'impression */}
      <div className="print-header border-b-2 border-gray-200 pb-4 mb-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img 
              src="/logo.jpg" 
              alt="T.A.Y. Logo" 
              className="w-16 h-16 rounded-full object-cover" 
            />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
              <p className="text-sm text-gray-500">Société Transport ABOUBAKAR YARORO</p>
              <p className="text-xs text-gray-500">BP 14871 Yaoundé</p>
              <p className="text-xs text-gray-500">etsyaroro.logistique@gmail.com</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Date: {new Date().toLocaleDateString('fr-FR')}</p>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className="print-content mb-8">
        {children}
      </div>

      {/* Pied de page d'impression */}
      {showFooter && (
        <div className="print-footer border-t-2 border-gray-200 pt-4 mt-auto">
          <div className="flex justify-between text-xs text-gray-500">
            <div>
              <p>Société Transport ABOUBAKAR YARORO</p>
              <p>BP 14871 Yaoundé | etsyaroro.logistique@gmail.com</p>
            </div>
            <div className="text-right">
              <p>Page 1</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PrintButton({ onClick }: { onClick?: () => void }) {
  const handlePrint = () => {
    if (onClick) onClick();
    window.print();
  };

  return (
    <button 
      onClick={handlePrint}
      className="no-print bg-primary hover:bg-primary/90 text-white py-2 px-4 rounded-md flex items-center gap-2"
    >
      <i className="fas fa-print"></i>
      Imprimer
    </button>
  );
}