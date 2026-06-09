import { getBackendOrigin } from '../../../worker/src/config/env.js';
import {
  isRealtimeDurableObjectsEnabled,
  isValidDocumentId,
} from '../../../worker/src/config/realtime.js';
import { getRouteOwnershipMap } from '../../../worker/src/config/routes.js';

describe('Worker configuration', () => {
  it('uses localhost backend fallback only for local environments', () => {
    expect(getBackendOrigin({ env: { ENVIRONMENT: 'development' } })).toBe('http://localhost:3000');
    expect(getBackendOrigin({ env: { ENVIRONMENT: 'production' } })).toBeNull();
  });

  it('sanitizes configured backend origin', () => {
    expect(
      getBackendOrigin({
        env: { ENVIRONMENT: 'production', BACKEND_ORIGIN: 'https://api.example.com/' },
      })
    ).toBe('https://api.example.com');
  });

  it('exposes route ownership groups', () => {
    const routes = getRouteOwnershipMap();

    expect(routes.workerOwned.some((route) => route.pattern === '/api/health')).toBe(true);
    expect(routes.nodeProxied.some((route) => route.pattern === '/api/node/*')).toBe(true);
    expect(
      routes.featureFlaggedWorkerOwned.some((route) => route.pattern === '/ws/:documentId')
    ).toBe(true);
  });

  it('parses realtime flags and document ids', () => {
    expect(isRealtimeDurableObjectsEnabled({ REALTIME_DURABLE_OBJECTS_ENABLED: 'true' })).toBe(
      true
    );
    expect(isRealtimeDurableObjectsEnabled({ REALTIME_DURABLE_OBJECTS_ENABLED: 'false' })).toBe(
      false
    );
    expect(isValidDocumentId('doc_123-abc')).toBe(true);
    expect(isValidDocumentId('../secret')).toBe(false);
  });
});
