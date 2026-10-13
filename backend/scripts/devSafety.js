// Shared guard for scripts that change a database. Until a production release
// process is approved, they only run against a development database.
export function assertDevelopmentDatabase(config) {
  if (config.environment === 'production') {
    throw new Error('Refusing to run: NODE_ENV is "production".');
  }
  if (!config.db.database.endsWith('_dev')) {
    throw new Error(
      `Refusing to run: database "${config.db.database}" is not a development database (its name must end in "_dev").`,
    );
  }
}
