const fs = require('fs');
const path = require('path');

// Créer des icônes PWA simples en base64
const createIcon = (size) => {
  // Base64 d'une icône PNG simple T.A.Y verte
  const iconBase64 = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`;
  
  // Créer une icône PNG simple
  const canvas = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${size/8}" fill="#16a34a"/>
      <text x="${size/2}" y="${size/2 + size/16}" font-family="Arial, sans-serif" font-size="${size/4}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">T.A.Y</text>
    </svg>
  `;
  
  return `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`;
};

// Créer les icônes dans le dossier public
const sizes = [192, 512];
sizes.forEach(size => {
  const iconData = createIcon(size);
  // Sauvegarder comme fichier SVG temporaire puis convertir
  fs.writeFileSync(path.join('public', `icon-${size}x${size}.svg`), 
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${size/8}" fill="#16a34a"/>
      <text x="${size/2}" y="${size/2 + size/16}" font-family="Arial, sans-serif" font-size="${size/4}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">T.A.Y</text>
    </svg>`
  );
  console.log(`Icône ${size}x${size} créée`);
});

console.log('Icônes PWA générées avec succès !');