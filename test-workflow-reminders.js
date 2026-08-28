import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function testWorkflowReminders() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Insérer un workflow de test pour l'utilisateur admin (ID 1)
    const testWorkflow = {
      sessionId: 'test-workflow-' + Date.now(),
      userId: 1,
      currentStep: 2,
      status: 'in_progress',
      workflowData: JSON.stringify({
        registrationNumber: 'TEST123',
        brand: 'Mercedes',
        model: 'Actros',
        year: 2022,
        vin: 'WDB9644111L123456',
        vehicleType: 'tracteur',
        tonnage: 18,
        axleCount: 3,
        engineSpec: '12.8L OM471',
        purchaseDate: '2024-12-01',
        purchasePrice: 85000,
        fuelType: 'diesel',
        vinValidated: false,
        documents: {
          carteGrise: null,
          assurance: null,
          visiteTechnique: null,
          facturAchat: null
        },
        documentsUploaded: false,
        maintenanceScheduled: false,
        firstMaintenanceDate: '',
        maintenanceType: 'preventive',
        activated: false
      }),
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // Il y a 3 jours
      updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)  // Mis à jour il y a 1 jour
    };

    // Insérer le workflow de test
    const insertQuery = `
      INSERT INTO vehicle_acquisition_workflows 
      (session_id, user_id, current_step, status, workflow_data, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      testWorkflow.sessionId,
      testWorkflow.userId,
      testWorkflow.currentStep,
      testWorkflow.status,
      testWorkflow.workflowData,
      testWorkflow.createdAt,
      testWorkflow.updatedAt
    ]);

    console.log('✅ Workflow de test créé:', result.rows[0]);

    // Insérer un deuxième workflow plus ancien
    const oldWorkflow = {
      sessionId: 'old-workflow-' + Date.now(),
      userId: 1,
      currentStep: 1,
      status: 'in_progress',
      workflowData: JSON.stringify({
        registrationNumber: 'OLD456',
        brand: 'Volvo',
        model: 'FH',
        year: 2021,
        vin: '',
        vehicleType: 'tracteur',
        tonnage: 0,
        axleCount: 2,
        engineSpec: '',
        purchaseDate: '',
        purchasePrice: 0,
        fuelType: 'diesel',
        vinValidated: false,
        documents: {
          carteGrise: null,
          assurance: null,
          visiteTechnique: null,
          facturAchat: null
        },
        documentsUploaded: false,
        maintenanceScheduled: false,
        firstMaintenanceDate: '',
        maintenanceType: 'preventive',
        activated: false
      }),
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Il y a 10 jours
      updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)   // Mis à jour il y a 8 jours
    };

    const result2 = await pool.query(insertQuery, [
      oldWorkflow.sessionId,
      oldWorkflow.userId,
      oldWorkflow.currentStep,
      oldWorkflow.status,
      oldWorkflow.workflowData,
      oldWorkflow.createdAt,
      oldWorkflow.updatedAt
    ]);

    console.log('✅ Workflow ancien créé:', result2.rows[0]);

    // Vérifier les workflows actifs
    const activeQuery = `
      SELECT * FROM vehicle_acquisition_workflows 
      WHERE user_id = $1 AND status != 'completed' AND status != 'abandoned'
      ORDER BY updated_at DESC
    `;

    const activeResult = await pool.query(activeQuery, [1]);
    console.log('📋 Workflows actifs trouvés:', activeResult.rows.length);
    
    activeResult.rows.forEach((workflow, index) => {
      const workflowData = typeof workflow.workflow_data === 'string' 
        ? JSON.parse(workflow.workflow_data) 
        : workflow.workflow_data;
      console.log(`  ${index + 1}. ${workflowData.registrationNumber} - ${workflowData.brand} ${workflowData.model} (Étape ${workflow.current_step})`);
    });

  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
  } finally {
    await pool.end();
  }
}

testWorkflowReminders();