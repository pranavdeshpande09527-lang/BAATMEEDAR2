// PM2 Ecosystem Configuration — BAATMEEDAR
// Usage:
//   Development:  pm2 start ecosystem.config.js --env development
//   Production:   pm2 start ecosystem.config.js --env production
//   Reload:       pm2 reload baatmeedar
//   Logs:         pm2 logs baatmeedar
//   Stop:         pm2 stop baatmeedar

module.exports = {
  apps: [
    {
      name:        'baatmeedar',
      script:      './src/server.js',
      instances:   'max',          // Use all available CPU cores
      exec_mode:   'cluster',      // Cluster mode for multi-core utilization
      watch:       false,          // Never watch in production
      max_memory_restart: '512M',  // Restart if process exceeds 512MB RAM

      // Graceful shutdown: allow up to 10s for in-flight requests to drain
      kill_timeout:         10000,
      listen_timeout:       5000,
      shutdown_with_message: true,

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file:  './logs/error.log',
      out_file:    './logs/out.log',
      merge_logs:  true,

      env_development: {
        NODE_ENV:  'development',
        PORT:      3000,
        instances: 1,
        exec_mode: 'fork',
        watch:     true,
        ignore_watch: ['node_modules', 'logs', 'prisma/*.db'],
      },

      env_production: {
        NODE_ENV: 'production',
        PORT:     3000,
      },
    },
  ],
};
