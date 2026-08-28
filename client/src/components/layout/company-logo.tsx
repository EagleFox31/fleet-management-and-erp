import React from 'react';
import TayLogoImg from '@/assets/tay-logo.jpg';

// URL relative pour utilisation dans les références
const TayLogoUrl = TayLogoImg;

export function CompanyLogo() {
  return (
    <div className="w-10 h-10 rounded-full overflow-hidden">
      <img src={TayLogoUrl} alt="T.A.Y Logo" className="w-full h-full object-cover" />
    </div>
  );
}

export const companyInfo = {
  name: "Société Transport ABOUBAKAR yaroro",
  address: "BP 14871 Yaoundé",
  email: "etsyaroro.logistique@gmail.com",
  logoUrl: TayLogoUrl
};