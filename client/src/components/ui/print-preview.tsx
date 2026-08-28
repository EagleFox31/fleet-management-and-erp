import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrintLayout, PrintButton } from "./print-layout";

interface PrintPreviewProps {
  title: string;
  content: React.ReactNode;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}

export function PrintPreview({ title, content, open, onOpenChange }: PrintPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Aperçu avant impression</DialogTitle>
        </DialogHeader>
        
        <div className="max-h-[70vh] overflow-auto mt-4 border rounded-md p-6">
          <PrintLayout title={title}>
            {content}
          </PrintLayout>
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <PrintButton />
        </div>
      </DialogContent>
    </Dialog>
  );
}