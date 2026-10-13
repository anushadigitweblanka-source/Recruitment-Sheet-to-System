export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Express recognises an error handler by its four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
}
