export const ROUTE_OWNERSHIP = {
  workerOwned: [
    {
      pattern: '/',
      methods: ['GET'],
      owner: 'worker',
      description: 'Worker runtime status endpoint.',
    },
    {
      pattern: '/api/health',
      methods: ['GET'],
      owner: 'worker',
      description: 'Worker health check.',
    },
    {
      pattern: '/api/config',
      methods: ['GET'],
      owner: 'worker',
      description: 'Safe public Worker runtime configuration.',
    },
  ],
  nodeProxied: [
    {
      pattern: '/api/node/*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      owner: 'node',
      description: 'Legacy Node auth, user, document, CSRF, session, and database APIs.',
    },
  ],
  featureFlaggedWorkerOwned: [
    {
      pattern: '/ws/:documentId',
      methods: ['GET'],
      owner: 'worker',
      featureFlag: 'REALTIME_DURABLE_OBJECTS_ENABLED',
      description: 'Durable Object WebSocket collaboration skeleton.',
    },
    {
      pattern: '/api/realtime/:documentId',
      methods: ['GET'],
      owner: 'worker',
      featureFlag: 'REALTIME_DURABLE_OBJECTS_ENABLED',
      description: 'Alternate Durable Object WebSocket collaboration endpoint.',
    },
  ],
};

export function getRouteOwnershipMap() {
  return ROUTE_OWNERSHIP;
}
