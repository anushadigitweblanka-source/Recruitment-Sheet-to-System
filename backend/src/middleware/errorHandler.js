export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Express recognises an error handler by its four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // A body over the allowed size is the sender's problem, not a server fault.
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'too_large', message: 'The upload is too large.' });
  }
  console.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
}
