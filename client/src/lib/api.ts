/**
 * Utilitaires pour les appels API avec des fichiers
 */

// Fonction pour télécharger un fichier
export async function uploadFile(url: string, formData: FormData): Promise<any> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      // Ne pas définir Content-Type car FormData le fait automatiquement
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || response.statusText);
    }

    return await response.json();
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// Fonction pour supprimer un document
export async function deleteDocument(url: string): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || response.statusText);
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
}