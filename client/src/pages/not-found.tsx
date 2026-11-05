import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();
  
  const handleGoBack = () => {
    setLocation("/dashboard");
  };
  
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4 border-t-4 border-t-primary shadow-lg">
        <CardContent className="pt-10 pb-6 px-6 text-center">
          <div className="mb-6 flex justify-center">
            <div className="bg-primary/10 p-3 rounded-full">
              <i className="fas fa-exclamation-triangle text-4xl text-primary-text"></i>
            </div>
          </div>
          
          <h1 className="text-2xl font-semibold text-slate-800 mb-2">
            Page non trouvée
          </h1>
          
          <p className="text-slate-600 mb-6">
            Désolé, la page que vous recherchez n'existe pas ou a été déplacée.
          </p>
          
          <div className="p-4 bg-slate-50 rounded-md border border-slate-200 text-left">
            <h3 className="text-sm font-medium text-slate-700 mb-1">Suggestions :</h3>
            <ul className="list-disc text-sm ml-5 text-slate-600 space-y-1">
              <li>Vérifiez l'URL pour vous assurer qu'elle est correcte</li>
              <li>Retournez à la page d'accueil</li>
              <li>Contactez l'administrateur système si le problème persiste</li>
            </ul>
          </div>
        </CardContent>
        
        <CardFooter className="border-t bg-slate-50 flex justify-between gap-4 px-6 py-4">
          <Button 
            variant="outline" 
            className="flex-1"
            onClick={() => window.history.back()}
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Retour en arrière
          </Button>
          
          <Button 
            className="flex-1"
            onClick={handleGoBack}
          >
            <i className="fas fa-home mr-2"></i>
            Accueil
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
