import { successResponse } from '../utils/responses.js';

export function handleConfig(c) {
  const appName = c.env?.APP_NAME || 'SyncroEdit';
  const environment = c.env?.ENVIRONMENT || 'development';
  const apiVersion = c.env?.API_VERSION || 'v1';

  return successResponse(c, {
    appName,
    environment,
    apiVersion,
    workerRuntime: true,
  });
}
