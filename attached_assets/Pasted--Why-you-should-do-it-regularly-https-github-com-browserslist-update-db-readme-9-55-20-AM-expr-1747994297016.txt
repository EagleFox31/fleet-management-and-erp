  Why you should do it regularly: https://github.com/browserslist/update-db#readme
9:55:20 AM [express] GET /api/auth/me 401 in 3ms :: {"message":"Non authentifié"}
9:55:20 AM [express] GET /api/auth/me 401 in 0ms :: {"message":"Non authentifié"}
9:56:04 AM [express] GET /api/auth/me 401 in 1ms :: {"message":"Non authentifié"}
9:56:26 AM [express] GET /api/auth/me 401 in 1ms :: {"message":"Non authentifié"}
9:56:32 AM [express] GET /api/auth/me 401 in 1ms :: {"message":"Non authentifié"}
9:56:41 AM [express] GET /api/auth/me 401 in 2ms :: {"message":"Non authentifié"}
9:56:47 AM [express] POST /api/auth/login 200 in 2532ms :: {"id":1,"username":"admin","name":"Admini…
9:56:48 AM [express] GET /api/vehicles/check-alerts 404 in 44ms :: {"message":"Véhicule non trouvé"}
9:56:48 AM [express] GET /api/statistics/fleet 304 in 237ms :: {"operational":"3","maintenance":"1",…
9:56:48 AM [express] GET /api/statistics/maintenance-compliance 304 in 244ms :: {"compliant":"4","ov…
Requête reçue - Filtres: {
  search: '',
  status: undefined,
  vehicle_type: undefined,
  limit: 10,
  offset: 0,
  query_params: { search: '', limit: '10', offset: '0' }
}
9:56:48 AM [express] GET /api/statistics/maintenance-cost 200 in 6ms
9:56:48 AM [express] GET /api/statistics/scheduled-maintenance 304 in 46ms :: {"scheduled":"2"}
9:56:48 AM [express] GET /api/vehicles 304 in 91ms :: {"vehicles":[{"id":3,"registrationNumber":"AB1…
9:56:48 AM [express] GET /api/work-orders/statistics 304 in 85ms :: {"pending":2,"inProgress":1,"com…
9:56:49 AM [express] GET /api/fuel-records/statistics 304 in 257ms :: {"period":"month","totalFuel":…
Génération de données pour la période: month, du 2025-05-01 au 2025-05-23, granularité: day
9:56:50 AM [express] GET /api/statistics/fleet-history 304 in 2270ms :: [{"date":"01-05","operationa…
9:57:00 AM [express] GET /api/work-orders/statistics 304 in 82ms :: {"pending":2,"inProgress":1,"com…
9:57:00 AM [express] GET /api/work-orders 304 in 389ms :: {"workOrders":[{"id":4,"title":"Essieux","…
9:57:11 AM [express] GET /api/users/technicians 400 in 2ms :: {"message":"ID d'utilisateur invalide"}
Get parts used error: TypeError: Cannot convert undefined or null to object
    at Function.entries (<anonymous>)
    at orderSelectedFields (/home/runner/workspace/node_modules/src/utils.ts:77:16)
    at <anonymous> (/home/runner/workspace/node_modules/src/utils.ts:88:19)
    at Array.reduce (<anonymous>)
    at orderSelectedFields (/home/runner/workspace/node_modules/src/utils.ts:77:32)
    at <anonymous> (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:979:23)
    at Object.startActiveSpan (/home/runner/workspace/node_modules/src/tracing.ts:27:11)
    at PgSelectBase._prepare (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:978:17)
    at <anonymous> (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:1009:16)
    at Object.startActiveSpan (/home/runner/workspace/node_modules/src/tracing.ts:27:11)
    at PgSelectBase.execute (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:1008:17)
    at PgSelectBase.then (/home/runner/workspace/node_modules/src/query-promise.ts:31:15)
9:57:11 AM [express] GET /api/work-orders/4/parts 500 in 8ms :: {"message":"Erreur serveur"}
Work order retrieved: {
  "id": 4,
  "title": "Essieux",
  "description": "lknlsklskcnlskclsk,dlk,dls,d",
  "diagnosis": "",
  "status": "completed",
  "priority": "critical",
  "vehicleId": 2,
  "vehicleRegistration": "CE123",
  "vehicleBrand": "HOWAN",
  "vehicleModel": "WH",
  "technicianId": 5,
  "startDate": "2025-05-22T00:00:00.000Z",
  "endDate": null,
  "duration": null,
  "cost": null,
  "isPreventive": false,
  "createdAt": "2025-05-22T10:00:27.636Z",
  "vehicleRegistrationNumber": "CE123",
  "technicianName": "jenn",
  "technicianUsername": "Law"
}
9:57:11 AM [express] GET /api/work-orders/4 304 in 185ms :: {"id":4,"title":"Essieux","description":…
9:57:12 AM [express] GET /api/vehicles/2 304 in 38ms :: {"id":2,"registrationNumber":"CE123","brand"…
Get parts used error: TypeError: Cannot convert undefined or null to object
    at Function.entries (<anonymous>)
    at orderSelectedFields (/home/runner/workspace/node_modules/src/utils.ts:77:16)
    at <anonymous> (/home/runner/workspace/node_modules/src/utils.ts:88:19)
    at Array.reduce (<anonymous>)
    at orderSelectedFields (/home/runner/workspace/node_modules/src/utils.ts:77:32)
    at <anonymous> (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:979:23)
    at Object.startActiveSpan (/home/runner/workspace/node_modules/src/tracing.ts:27:11)
    at PgSelectBase._prepare (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:978:17)
    at <anonymous> (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:1009:16)
    at Object.startActiveSpan (/home/runner/workspace/node_modules/src/tracing.ts:27:11)
    at PgSelectBase.execute (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:1008:17)
    at PgSelectBase.then (/home/runner/workspace/node_modules/src/query-promise.ts:31:15)
9:57:25 AM [express] GET /api/work-orders/3/parts 500 in 3ms :: {"message":"Erreur serveur"}
9:57:25 AM [express] GET /api/users/technicians 400 in 1ms :: {"message":"ID d'utilisateur invalide"}
Work order retrieved: {
  "id": 3,
  "title": "Test Frein",
  "description": "Tets de freins RAS",
  "diagnosis": "",
  "status": "in_progress",
  "priority": "high",
  "vehicleId": 3,
  "vehicleRegistration": "AB123CD",
  "vehicleBrand": "Renault",
  "vehicleModel": "Premium",
  "technicianId": 5,
  "startDate": "2025-05-23T00:00:00.000Z",
  "endDate": null,
  "duration": null,
  "cost": null,
  "isPreventive": false,
  "createdAt": "2025-05-22T09:58:58.388Z",
  "vehicleRegistrationNumber": "AB123CD",
  "technicianName": "jenn",
  "technicianUsername": "Law"
}
9:57:25 AM [express] GET /api/work-orders/3 304 in 164ms :: {"id":3,"title":"Test Frein","descriptio…
9:57:26 AM [express] GET /api/vehicles/3 304 in 36ms :: {"id":3,"registrationNumber":"AB123CD","bran…
Get parts used error: TypeError: Cannot convert undefined or null to object
    at Function.entries (<anonymous>)
    at orderSelectedFields (/home/runner/workspace/node_modules/src/utils.ts:77:16)
    at <anonymous> (/home/runner/workspace/node_modules/src/utils.ts:88:19)
    at Array.reduce (<anonymous>)
    at orderSelectedFields (/home/runner/workspace/node_modules/src/utils.ts:77:32)
    at <anonymous> (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:979:23)
    at Object.startActiveSpan (/home/runner/workspace/node_modules/src/tracing.ts:27:11)
    at PgSelectBase._prepare (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:978:17)
    at <anonymous> (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:1009:16)
    at Object.startActiveSpan (/home/runner/workspace/node_modules/src/tracing.ts:27:11)
    at PgSelectBase.execute (/home/runner/workspace/node_modules/src/pg-core/query-builders/select.ts:1008:17)
    at PgSelectBase.then (/home/runner/workspace/node_modules/src/query-promise.ts:31:15)
9:57:32 AM [express] GET /api/work-orders/3/parts 500 in 2ms :: {"message":"Erreur serveur"}
9:57:32 AM [express] GET /api/users/technicians 400 in 1ms :: {"message":"ID d'utilisateur invalide"}