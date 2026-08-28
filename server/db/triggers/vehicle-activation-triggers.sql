-- ============================================================================
-- TRIGGERS D'ACTIVATION DES VÉHICULES
-- Automatise la création complète d'un véhicule lors de l'activation du workflow
-- ============================================================================

-- Fonction pour extraire et créer un véhicule complet depuis les données du workflow
CREATE OR REPLACE FUNCTION create_vehicle_from_workflow()
RETURNS TRIGGER AS $$
DECLARE
    vehicle_id INTEGER;
    workflow_data JSONB;
    documents_data JSONB;
    maintenance_data JSONB;
    doc_key TEXT;
    doc_file JSONB;
BEGIN
    -- Vérifier que le workflow est activé (étape 5 terminée)
    IF NEW.current_step = 5 AND NEW.status = 'completed' THEN
        workflow_data := NEW.data;
        
        -- Extraire les données du véhicule depuis le workflow
        INSERT INTO vehicles (
            registration_number,
            brand,
            model,
            year,
            vin,
            vehicle_type,
            tonnage,
            axle_count,
            engine_spec,
            purchase_date,
            purchase_price,
            fuel_type,
            status,
            mileage,
            license_plate_expiry,
            insurance_expiry,
            technical_inspection_date,
            notes,
            next_maintenance_date,
            next_maintenance_mileage
        ) VALUES (
            workflow_data->>'registrationNumber',
            workflow_data->>'brand',
            workflow_data->>'model',
            (workflow_data->>'year')::INTEGER,
            workflow_data->>'vin',
            workflow_data->>'vehicleType',
            (workflow_data->>'tonnage')::REAL,
            (workflow_data->>'axleCount')::INTEGER,
            workflow_data->>'engineSpec',
            (workflow_data->>'purchaseDate')::DATE,
            (workflow_data->>'purchasePrice')::NUMERIC,
            workflow_data->>'fuelType',
            COALESCE(workflow_data->>'status', 'operational'),
            COALESCE((workflow_data->>'mileage')::INTEGER, 0),
            NULLIF(workflow_data->>'licensePlateExpiry', '')::DATE,
            NULLIF(workflow_data->>'insuranceExpiry', '')::DATE,
            NULLIF(workflow_data->>'technicalInspectionDate', '')::DATE,
            workflow_data->>'notes',
            NULLIF(workflow_data->>'firstMaintenanceDate', '')::DATE,
            CASE 
                WHEN workflow_data->>'firstMaintenanceDate' IS NOT NULL 
                THEN COALESCE((workflow_data->>'mileage')::INTEGER, 0) + 10000
                ELSE NULL
            END
        ) RETURNING id INTO vehicle_id;

        -- Traitement des documents uploadés
        documents_data := workflow_data->'documents';
        IF documents_data IS NOT NULL THEN
            -- Carte grise
            IF documents_data ? 'carteGrise' AND documents_data->'carteGrise' IS NOT NULL THEN
                INSERT INTO vehicle_documents (
                    vehicle_id,
                    document_type,
                    file_name,
                    file_path,
                    upload_date,
                    expiry_date
                ) VALUES (
                    vehicle_id,
                    'carte_grise',
                    documents_data->'carteGrise'->>'name',
                    '/uploads/vehicles/' || vehicle_id || '/carte_grise_' || documents_data->'carteGrise'->>'name',
                    NOW(),
                    NULLIF(workflow_data->>'licensePlateExpiry', '')::DATE
                );
            END IF;

            -- Assurance
            IF documents_data ? 'assurance' AND documents_data->'assurance' IS NOT NULL THEN
                INSERT INTO vehicle_documents (
                    vehicle_id,
                    document_type,
                    file_name,
                    file_path,
                    upload_date,
                    expiry_date
                ) VALUES (
                    vehicle_id,
                    'insurance',
                    documents_data->'assurance'->>'name',
                    '/uploads/vehicles/' || vehicle_id || '/assurance_' || documents_data->'assurance'->>'name',
                    NOW(),
                    NULLIF(workflow_data->>'insuranceExpiry', '')::DATE
                );
            END IF;

            -- Visite technique
            IF documents_data ? 'visiteTechnique' AND documents_data->'visiteTechnique' IS NOT NULL THEN
                INSERT INTO vehicle_documents (
                    vehicle_id,
                    document_type,
                    file_name,
                    file_path,
                    upload_date,
                    expiry_date
                ) VALUES (
                    vehicle_id,
                    'technical_inspection',
                    documents_data->'visiteTechnique'->>'name',
                    '/uploads/vehicles/' || vehicle_id || '/visite_technique_' || documents_data->'visiteTechnique'->>'name',
                    NOW(),
                    NULLIF(workflow_data->>'technicalInspectionDate', '')::DATE
                );
            END IF;

            -- Facture d'achat
            IF documents_data ? 'facturAchat' AND documents_data->'facturAchat' IS NOT NULL THEN
                INSERT INTO vehicle_documents (
                    vehicle_id,
                    document_type,
                    file_name,
                    file_path,
                    upload_date
                ) VALUES (
                    vehicle_id,
                    'purchase_invoice',
                    documents_data->'facturAchat'->>'name',
                    '/uploads/vehicles/' || vehicle_id || '/facture_achat_' || documents_data->'facturAchat'->>'name',
                    NOW()
                );
            END IF;
        END IF;

        -- Créer la maintenance programmée si spécifiée
        IF (workflow_data->>'maintenanceScheduled')::BOOLEAN = true 
           AND workflow_data->>'firstMaintenanceDate' IS NOT NULL THEN
            INSERT INTO work_orders (
                vehicle_id,
                title,
                description,
                priority,
                status,
                scheduled_date,
                work_type,
                estimated_duration,
                created_at
            ) VALUES (
                vehicle_id,
                'Première maintenance préventive',
                'Maintenance préventive programmée lors de l''acquisition du véhicule',
                'medium',
                'scheduled',
                (workflow_data->>'firstMaintenanceDate')::DATE,
                COALESCE(workflow_data->>'maintenanceType', 'preventive'),
                240, -- 4 heures par défaut
                NOW()
            );
        END IF;

        -- Créer l'entrée dans l'historique des statuts
        INSERT INTO status_history (
            vehicle_id,
            status,
            previous_status,
            change_reason,
            changed_by,
            mileage_at_change,
            created_at
        ) VALUES (
            vehicle_id,
            COALESCE(workflow_data->>'status', 'operational'),
            NULL,
            'Véhicule créé via workflow d''acquisition',
            1, -- Utilisateur système par défaut
            COALESCE((workflow_data->>'mileage')::INTEGER, 0),
            NOW()
        );

        -- Log de l'activité
        INSERT INTO activity_logs (
            user_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        ) VALUES (
            1, -- Utilisateur système
            'CREATE',
            'vehicle',
            vehicle_id,
            jsonb_build_object(
                'source', 'workflow_activation',
                'workflow_id', NEW.id,
                'session_id', NEW.session_id,
                'registration_number', workflow_data->>'registrationNumber',
                'brand', workflow_data->>'brand',
                'model', workflow_data->>'model'
            ),
            NOW()
        );

        -- Mettre à jour le workflow pour indiquer la création du véhicule
        NEW.data := NEW.data || jsonb_build_object(
            'vehicleId', vehicle_id,
            'vehicleCreated', true,
            'activationCompletedAt', NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger sur la table workflows
DROP TRIGGER IF EXISTS trigger_create_vehicle_on_activation ON workflows;
CREATE TRIGGER trigger_create_vehicle_on_activation
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION create_vehicle_from_workflow();

-- ============================================================================
-- FONCTION POUR SYNCHRONISER LES DONNÉES DES WORKFLOWS EXISTANTS
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_completed_workflows()
RETURNS TABLE(
    workflow_id INTEGER,
    vehicle_id INTEGER,
    registration_number TEXT,
    status TEXT
) AS $$
DECLARE
    workflow_record RECORD;
    new_vehicle_id INTEGER;
    workflow_data JSONB;
BEGIN
    -- Parcourir tous les workflows completés qui n'ont pas encore créé de véhicule
    FOR workflow_record IN 
        SELECT w.* FROM workflows w 
        WHERE w.current_step = 5 
        AND w.status = 'completed'
        AND w.workflow_type = 'vehicle_acquisition'
        AND (w.data->>'vehicleCreated' IS NULL OR (w.data->>'vehicleCreated')::BOOLEAN = false)
    LOOP
        workflow_data := workflow_record.data;
        
        -- Vérifier que le véhicule n'existe pas déjà
        IF NOT EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.registration_number = workflow_data->>'registrationNumber'
        ) THEN
            -- Créer le véhicule en déclenchant le trigger
            UPDATE workflows 
            SET data = workflow_data, updated_at = NOW()
            WHERE id = workflow_record.id;
            
            -- Récupérer l'ID du véhicule créé
            SELECT v.id INTO new_vehicle_id 
            FROM vehicles v 
            WHERE v.registration_number = workflow_data->>'registrationNumber';
            
            -- Retourner les informations
            workflow_id := workflow_record.id;
            vehicle_id := new_vehicle_id;
            registration_number := workflow_data->>'registrationNumber';
            status := 'created';
            
            RETURN NEXT;
        ELSE
            -- Le véhicule existe déjà, marquer le workflow comme synchronisé
            UPDATE workflows 
            SET data = workflow_data || jsonb_build_object('vehicleCreated', true, 'syncedAt', NOW())
            WHERE id = workflow_record.id;
            
            workflow_id := workflow_record.id;
            vehicle_id := NULL;
            registration_number := workflow_data->>'registrationNumber';
            status := 'already_exists';
            
            RETURN NEXT;
        END IF;
    END LOOP;
    
    RETURN;
END;
$$ LANGUAGE plpgsql;