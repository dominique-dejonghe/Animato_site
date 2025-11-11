// PM2 Configuration voor Animato Koor Website
// Development environment met D1 local database

module.exports = {
  apps: [
    {
      name: 'animato-koor',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=animato-production --local --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false, // Disable PM2 file monitoring (wrangler has its own)
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
}
