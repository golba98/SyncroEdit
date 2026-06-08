export function successResponse(c, data = {}, status = 200) {
  return c.json(
    {
      ok: true,
      ...data,
    },
    status
  );
}

export function errorResponse(c, message, status = 500) {
  return c.json(
    {
      ok: false,
      error: message,
    },
    status
  );
}

export function notFoundResponse(c, message = 'Not Found') {
  return c.json(
    {
      ok: false,
      error: message,
    },
    404
  );
}
