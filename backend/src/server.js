import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config/env.js';
import { createPool } from './db/pool.js';
import { createMailService } from './modules/notifications/mailService.js';
import { runNotificationScheduler } from './modules/notifications/notifications.service.js';
import { runWeeklyReport } from './modules/notifications/weeklyReport.js';

let config;
try {
  loadEnvFile();
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const pool = createPool(config.db);
const app = createApp({ config, pool });

const server = app.listen(config.port, config.host, () => {
  console.log(`Backend listening on http://${config.host}:${config.port} (${config.environment})`);
});

// The notification job from the task guide: every 15 minutes it sends the
// reminders whose send_at has passed. One run never overlaps itself here,
// and the row claiming makes even runs from two servers safe. A failed run
// is logged and the next one simply tries again.
const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const mail = createMailService(config);
let schedulerRunning = false;
async function schedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const summary = await runNotificationScheduler(pool, mail, { config });
    if (summary.checked > 0) {
      console.log(
        `notification run (${summary.mode}): ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped`,
      );
    }
    // The Monday 08:00 weekly report rides on the same job; it sends at most
    // once per week (see weeklyReport.js).
    const weekly = await runWeeklyReport(pool, mail);
    if (weekly.status === 'sent' || weekly.status === 'failed') {
      console.log(`weekly report (${mail.mode}) for ${weekly.weekStart}: ${weekly.status}`);
    }
  } catch (err) {
    console.error(`notification run failed: ${err.message}`);
  } finally {
    schedulerRunning = false;
  }
}
const schedulerTimer = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
schedulerTick();

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  clearInterval(schedulerTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
